pub mod local_adapter;
pub mod sync_config;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use chrono::{DateTime, Utc};
use sha2::{Sha256, Digest};
use sync_config::SyncConfig;

// ──────────────────────────────────────────────
// Core Types
// ──────────────────────────────────────────────

/// Represents a single file's metadata for sync tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub relative_path: String,
    pub sha256: String,
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub last_synced: Option<DateTime<Utc>>,
}

/// Change detected during scan
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub relative_path: String,
    pub change_type: ChangeType,
    pub local_meta: Option<FileMeta>,
    pub remote_meta: Option<FileMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeType {
    Added,      // exists locally but not remotely
    Modified,   // exists in both but hashes differ
    Deleted,    // exists remotely but not locally
}

/// Conflict info when both sides changed the same file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub relative_path: String,
    pub local_meta: FileMeta,
    pub remote_meta: FileMeta,
    pub resolution: ConflictResolution,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictResolution {
    KeepLocal,
    KeepRemote,
    KeepBoth,   // rename remote copy with suffix
    Pending,
}

/// Sync operation to execute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOperation {
    pub relative_path: String,
    pub op_type: SyncOpType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncOpType {
    Upload,
    Download,
    DeleteRemote,
    DeleteLocal,
    BackupAndUpload(String),   // backup path
    BackupAndDownload(String), // backup path
}

/// Result of a sync operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub total_changes: usize,
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub conflicts: usize,
    pub errors: Vec<SyncError>,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    /// State updates to persist to sync_state table
    pub state_updates: Vec<SyncStateUpdate>,
}

/// Update to apply to the sync_state table after sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStateUpdate {
    pub file_path: String,
    pub local_hash: String,
    pub remote_hash: Option<String>,
    pub sync_status: String,
    pub last_synced: i64,
    pub remote_fid: Option<String>,
    pub version: i32,
    /// If true, delete this entry from sync_state
    pub delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncError {
    pub relative_path: String,
    pub message: String,
}

/// Overall sync status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub is_syncing: bool,
    pub last_sync: Option<DateTime<Utc>>,
    pub last_result: Option<SyncResult>,
    pub pending_changes: usize,
    pub sync_dir: Option<String>,
}

// ──────────────────────────────────────────────
// Sync Adapter Trait
// ──────────────────────────────────────────────

/// Trait for cloud storage backends.
/// Implement this to add support for Baidu Netdisk, S3, OneDrive, etc.
#[async_trait::async_trait]
pub trait SyncAdapter: Send + Sync {
    /// List all files with metadata from the remote storage
    async fn list_remote_files(&self) -> anyhow::Result<Vec<FileMeta>>;

    /// Download a file from remote storage, return its content
    async fn download_file(&self, relative_path: &str) -> anyhow::Result<Vec<u8>>;

    /// Upload a file to remote storage
    async fn upload_file(&self, relative_path: &str, content: &[u8]) -> anyhow::Result<()>;

    /// Delete a file from remote storage
    async fn delete_remote_file(&self, relative_path: &str) -> anyhow::Result<()>;

    /// Check if the adapter is connected and authenticated
    async fn is_connected(&self) -> bool;

    /// Get adapter name for display
    fn adapter_name(&self) -> &str;
}

// ──────────────────────────────────────────────
// Change Detector
// ──────────────────────────────────────────────

pub struct ChangeDetector;

impl ChangeDetector {
    /// Compute SHA-256 hash of file content
    pub fn hash_content(content: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content);
        format!("{:x}", hasher.finalize())
    }

    /// Scan local directory and build file metadata map, applying SyncConfig filters
    pub fn scan_local(vault_path: &Path, config: &SyncConfig) -> anyhow::Result<HashMap<String, FileMeta>> {
        let mut files = HashMap::new();
        if !vault_path.exists() {
            return Ok(files);
        }

        for entry in walkdir::WalkDir::new(vault_path)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.') && name != ".vault"
            })
        {
            let entry = entry?;
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let relative = path
                .strip_prefix(vault_path)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();

            // Apply SyncConfig filters
            if !config.should_sync(&relative) {
                continue;
            }

            // Check file size limit
            let meta = entry.metadata()?;
            if config.max_file_size > 0 && meta.len() > config.max_file_size {
                tracing::debug!("Skipping {} (size {} > max {})", relative, meta.len(), config.max_file_size);
                continue;
            }

            let content = std::fs::read(path)?;
            let modified: DateTime<Utc> = meta.modified()
                .map(|t| t.into())
                .unwrap_or_else(|_| Utc::now());

            files.insert(relative.clone(), FileMeta {
                relative_path: relative,
                sha256: Self::hash_content(&content),
                size: content.len() as u64,
                modified,
                last_synced: None,
            });
        }

        Ok(files)
    }

    /// Three-way comparison: local vs remote vs sync_state
    /// Produces more accurate change detection than simple two-way diff
    pub fn detect_changes_with_state(
        local: &HashMap<String, FileMeta>,
        remote: &HashMap<String, FileMeta>,
        sync_states: &HashMap<String, SyncStateInfo>,
    ) -> Vec<FileChange> {
        let mut changes = Vec::new();
        let mut processed = std::collections::HashSet::new();

        // Check all local files
        for (path, local_meta) in local {
            processed.insert(path.clone());

            if let Some(remote_meta) = remote.get(path) {
                // Local + Remote both exist
                if let Some(state) = sync_states.get(path) {
                    // Has sync state: compare hashes
                    if local_meta.sha256 == remote_meta.sha256 {
                        // Both same → skip (synced)
                        continue;
                    } else if local_meta.sha256 != state.local_hash && remote_meta.sha256 == state.remote_hash.as_deref().unwrap_or(&state.local_hash) {
                        // Only local changed → Upload
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Modified,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: Some(remote_meta.clone()),
                        });
                    } else if remote_meta.sha256 != state.remote_hash.as_deref().unwrap_or(&state.local_hash) && local_meta.sha256 == state.local_hash {
                        // Only remote changed → Download
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Modified,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: Some(remote_meta.clone()),
                        });
                    } else {
                        // Both changed → Conflict
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Modified,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: Some(remote_meta.clone()),
                        });
                    }
                } else {
                    // No sync state: compare hashes
                    if local_meta.sha256 != remote_meta.sha256 {
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Modified,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: Some(remote_meta.clone()),
                        });
                    }
                }
            } else {
                // Local only, no remote
                if let Some(state) = sync_states.get(path) {
                    if state.sync_status == "deleted" {
                        // Was deleted, now recreated → treat as Modified (upload)
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Added,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: None,
                        });
                    } else {
                        // Was synced but remote missing → upload
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Added,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: None,
                        });
                    }
                } else {
                    // New file → Upload
                    changes.push(FileChange {
                        relative_path: path.clone(),
                        change_type: ChangeType::Added,
                        local_meta: Some(local_meta.clone()),
                        remote_meta: None,
                    });
                }
            }
        }

        // Check remote files not yet processed
        for (path, remote_meta) in remote {
            if processed.contains(path) {
                continue;
            }

            if local.contains_key(path) {
                continue; // already handled
            }

            // Remote only, no local
            if let Some(_state) = sync_states.get(path) {
                // Had state but local deleted → Delete remote
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Deleted,
                    local_meta: None,
                    remote_meta: Some(remote_meta.clone()),
                });
            } else {
                // No state, remote only → Download (cross-device)
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Deleted,
                    local_meta: None,
                    remote_meta: Some(remote_meta.clone()),
                });
            }
        }

        // Check sync_state entries that no longer exist in either local or remote
        for (path, _state) in sync_states {
            if !local.contains_key(path) && !remote.contains_key(path) {
                // Orphaned state → should be cleaned up (handled by caller)
            }
        }

        changes
    }
}

/// Sync state info used for three-way comparison
#[derive(Debug, Clone)]
pub struct SyncStateInfo {
    pub local_hash: String,
    pub remote_hash: Option<String>,
    pub sync_status: String,
    pub version: i32,
}

// ──────────────────────────────────────────────
// Conflict Resolver
// ──────────────────────────────────────────────

pub struct ConflictResolver {
    pub strategy: ConflictStrategy,
}

#[derive(Debug, Clone)]
pub enum ConflictStrategy {
    KeepNewer,      // keep the file with newer modified time
    KeepLocal,      // always keep local version
    KeepRemote,     // always keep remote version
    KeepBoth,       // keep both versions (rename remote)
}

impl ConflictStrategy {
    pub fn from_str(s: &str) -> Self {
        match s {
            "keep_local" => Self::KeepLocal,
            "keep_remote" => Self::KeepRemote,
            "keep_both" => Self::KeepBoth,
            _ => Self::KeepNewer,
        }
    }
}

impl ConflictResolver {
    pub fn new(strategy: ConflictStrategy) -> Self {
        Self { strategy }
    }

    /// Resolve a conflict between local and remote versions
    pub fn resolve(&self, local: &FileMeta, remote: &FileMeta) -> ConflictResolution {
        match &self.strategy {
            ConflictStrategy::KeepNewer => {
                if local.modified >= remote.modified {
                    ConflictResolution::KeepLocal
                } else {
                    ConflictResolution::KeepRemote
                }
            }
            ConflictStrategy::KeepLocal => ConflictResolution::KeepLocal,
            ConflictStrategy::KeepRemote => ConflictResolution::KeepRemote,
            ConflictStrategy::KeepBoth => ConflictResolution::KeepBoth,
        }
    }
}

// ──────────────────────────────────────────────
// Sync Engine
// ──────────────────────────────────────────────

pub struct SyncEngine {
    vault_path: PathBuf,
    adapter: Box<dyn SyncAdapter>,
    conflict_resolver: ConflictResolver,
    config: SyncConfig,
}

impl SyncEngine {
    pub fn new(
        vault_path: PathBuf,
        adapter: Box<dyn SyncAdapter>,
        conflict_strategy: ConflictStrategy,
        config: SyncConfig,
    ) -> Self {
        Self {
            vault_path,
            adapter,
            conflict_resolver: ConflictResolver::new(conflict_strategy),
            config,
        }
    }

    /// Run a full sync cycle: scan → detect → plan → execute
    /// sync_states: current sync_state entries from database
    pub async fn sync(&self, sync_states: &HashMap<String, SyncStateInfo>) -> anyhow::Result<SyncResult> {
        let started_at = Utc::now();
        let mut errors = Vec::new();
        let mut uploaded = 0usize;
        let mut downloaded = 0usize;
        let mut deleted = 0usize;
        let mut conflicts = 0usize;
        let mut state_updates = Vec::new();

        tracing::info!("Starting sync for vault: {:?}", self.vault_path);

        // 1. Scan local files (with SyncConfig filtering)
        let local_files = ChangeDetector::scan_local(&self.vault_path, &self.config)?;

        // 2. Get remote files
        let remote_metas = self.adapter.list_remote_files().await?;
        let remote_files: HashMap<String, FileMeta> = remote_metas
            .into_iter()
            .map(|m| (m.relative_path.clone(), m))
            .collect();

        // 3. Detect changes using three-way comparison
        let changes = ChangeDetector::detect_changes_with_state(&local_files, &remote_files, sync_states);
        let total_changes = changes.len();

        tracing::info!("Detected {} changes", total_changes);

        // 4. Execute sync operations
        for change in &changes {
            match change.change_type {
                ChangeType::Added => {
                    let local_path = self.vault_path.join(&change.relative_path);
                    match std::fs::read(&local_path) {
                        Ok(content) => {
                            if let Err(e) = self.adapter.upload_file(&change.relative_path, &content).await {
                                tracing::error!("Failed to upload {}: {}", change.relative_path, e);
                                errors.push(SyncError {
                                    relative_path: change.relative_path.clone(),
                                    message: format!("Upload failed: {}", e),
                                });
                            } else {
                                uploaded += 1;
                                let hash = ChangeDetector::hash_content(&content);
                                state_updates.push(SyncStateUpdate {
                                    file_path: change.relative_path.clone(),
                                    local_hash: hash.clone(),
                                    remote_hash: Some(hash),
                                    sync_status: "synced".to_string(),
                                    last_synced: Utc::now().timestamp(),
                                    remote_fid: None,
                                    version: 1,
                                    delete: false,
                                });
                                tracing::debug!("Uploaded: {}", change.relative_path);
                            }
                        }
                        Err(e) => {
                            errors.push(SyncError {
                                relative_path: change.relative_path.clone(),
                                message: format!("Read local file failed: {}", e),
                            });
                        }
                    }
                }
                ChangeType::Deleted => {
                    if let Err(e) = self.adapter.delete_remote_file(&change.relative_path).await {
                        tracing::error!("Failed to delete remote {}: {}", change.relative_path, e);
                        errors.push(SyncError {
                            relative_path: change.relative_path.clone(),
                            message: format!("Remote delete failed: {}", e),
                        });
                    } else {
                        deleted += 1;
                        // Mark sync_state for cleanup
                        state_updates.push(SyncStateUpdate {
                            file_path: change.relative_path.clone(),
                            local_hash: String::new(),
                            remote_hash: None,
                            sync_status: "deleted".to_string(),
                            last_synced: Utc::now().timestamp(),
                            remote_fid: None,
                            version: 0,
                            delete: true,
                        });
                        tracing::debug!("Deleted remote: {}", change.relative_path);
                    }
                }
                ChangeType::Modified => {
                    let local_meta = match change.local_meta.as_ref() {
                        Some(m) => m,
                        None => {
                            tracing::warn!("Modified change missing local_meta: {}", change.relative_path);
                            continue;
                        }
                    };
                    let remote_meta = match change.remote_meta.as_ref() {
                        Some(m) => m,
                        None => {
                            tracing::warn!("Modified change missing remote_meta: {}", change.relative_path);
                            continue;
                        }
                    };

                    // Check if only one side changed (not a true conflict)
                    let state = sync_states.get(&change.relative_path);
                    let local_only_changed = state.map(|s| {
                        local_meta.sha256 != s.local_hash && remote_meta.sha256 == s.remote_hash.as_deref().unwrap_or(&s.local_hash)
                    }).unwrap_or(false);
                    let remote_only_changed = state.map(|s| {
                        remote_meta.sha256 != s.remote_hash.as_deref().unwrap_or(&s.local_hash) && local_meta.sha256 == s.local_hash
                    }).unwrap_or(false);

                    if local_only_changed {
                        // Only local changed → upload
                        let local_path = self.vault_path.join(&change.relative_path);
                        if let Ok(content) = std::fs::read(&local_path) {
                            if let Err(e) = self.adapter.upload_file(&change.relative_path, &content).await {
                                errors.push(SyncError {
                                    relative_path: change.relative_path.clone(),
                                    message: format!("Upload failed: {}", e),
                                });
                            } else {
                                uploaded += 1;
                                let hash = ChangeDetector::hash_content(&content);
                                state_updates.push(SyncStateUpdate {
                                    file_path: change.relative_path.clone(),
                                    local_hash: hash.clone(),
                                    remote_hash: Some(hash),
                                    sync_status: "synced".to_string(),
                                    last_synced: Utc::now().timestamp(),
                                    remote_fid: None,
                                    version: state.map(|s| s.version + 1).unwrap_or(1),
                                    delete: false,
                                });
                            }
                        }
                    } else if remote_only_changed {
                        // Only remote changed → download
                        match self.adapter.download_file(&change.relative_path).await {
                            Ok(content) => {
                                let local_path = self.vault_path.join(&change.relative_path);
                                if let Err(e) = std::fs::write(&local_path, &content) {
                                    errors.push(SyncError {
                                        relative_path: change.relative_path.clone(),
                                        message: format!("Write local failed: {}", e),
                                    });
                                } else {
                                    downloaded += 1;
                                    let hash = ChangeDetector::hash_content(&content);
                                    state_updates.push(SyncStateUpdate {
                                        file_path: change.relative_path.clone(),
                                        local_hash: hash.clone(),
                                        remote_hash: Some(hash),
                                        sync_status: "synced".to_string(),
                                        last_synced: Utc::now().timestamp(),
                                        remote_fid: None,
                                        version: state.map(|s| s.version + 1).unwrap_or(1),
                                        delete: false,
                                    });
                                }
                            }
                            Err(e) => {
                                errors.push(SyncError {
                                    relative_path: change.relative_path.clone(),
                                    message: format!("Download failed: {}", e),
                                });
                            }
                        }
                    } else {
                        // Both changed → conflict resolution
                        let resolution = self.conflict_resolver.resolve(local_meta, remote_meta);

                        match resolution {
                            ConflictResolution::KeepLocal => {
                                let local_path = self.vault_path.join(&change.relative_path);
                                if let Ok(content) = std::fs::read(&local_path) {
                                    if let Err(e) = self.adapter.upload_file(&change.relative_path, &content).await {
                                        errors.push(SyncError {
                                            relative_path: change.relative_path.clone(),
                                            message: format!("Upload failed: {}", e),
                                        });
                                    } else {
                                        uploaded += 1;
                                        let hash = ChangeDetector::hash_content(&content);
                                        state_updates.push(SyncStateUpdate {
                                            file_path: change.relative_path.clone(),
                                            local_hash: hash.clone(),
                                            remote_hash: Some(hash),
                                            sync_status: "synced".to_string(),
                                            last_synced: Utc::now().timestamp(),
                                            remote_fid: None,
                                            version: state.map(|s| s.version + 1).unwrap_or(1),
                                            delete: false,
                                        });
                                    }
                                }
                            }
                            ConflictResolution::KeepRemote => {
                                match self.adapter.download_file(&change.relative_path).await {
                                    Ok(content) => {
                                        let local_path = self.vault_path.join(&change.relative_path);
                                        if let Err(e) = std::fs::write(&local_path, &content) {
                                            errors.push(SyncError {
                                                relative_path: change.relative_path.clone(),
                                                message: format!("Write local failed: {}", e),
                                            });
                                        } else {
                                            downloaded += 1;
                                            let hash = ChangeDetector::hash_content(&content);
                                            state_updates.push(SyncStateUpdate {
                                                file_path: change.relative_path.clone(),
                                                local_hash: hash.clone(),
                                                remote_hash: Some(hash),
                                                sync_status: "synced".to_string(),
                                                last_synced: Utc::now().timestamp(),
                                                remote_fid: None,
                                                version: state.map(|s| s.version + 1).unwrap_or(1),
                                                delete: false,
                                            });
                                        }
                                    }
                                    Err(e) => {
                                        errors.push(SyncError {
                                            relative_path: change.relative_path.clone(),
                                            message: format!("Download failed: {}", e),
                                        });
                                    }
                                }
                            }
                            ConflictResolution::KeepBoth => {
                                let local_path = self.vault_path.join(&change.relative_path);
                                let backup_name = format!(
                                    "{}.conflict-{}",
                                    change.relative_path,
                                    Utc::now().format("%Y%m%d-%H%M%S")
                                );
                                let backup_path = self.vault_path.join(&backup_name);

                                // Save local as backup
                                if let Ok(content) = std::fs::read(&local_path) {
                                    let _ = std::fs::create_dir_all(backup_path.parent().unwrap_or(&backup_path));
                                    let _ = std::fs::write(&backup_path, &content);
                                }

                                // Download remote as current
                                match self.adapter.download_file(&change.relative_path).await {
                                    Ok(content) => {
                                        let _ = std::fs::write(&local_path, &content);
                                        downloaded += 1;
                                        conflicts += 1;
                                        let hash = ChangeDetector::hash_content(&content);
                                        state_updates.push(SyncStateUpdate {
                                            file_path: change.relative_path.clone(),
                                            local_hash: hash.clone(),
                                            remote_hash: Some(hash),
                                            sync_status: "synced".to_string(),
                                            last_synced: Utc::now().timestamp(),
                                            remote_fid: None,
                                            version: state.map(|s| s.version + 1).unwrap_or(1),
                                            delete: false,
                                        });
                                    }
                                    Err(e) => {
                                        errors.push(SyncError {
                                            relative_path: change.relative_path.clone(),
                                            message: format!("Download for conflict resolution failed: {}", e),
                                        });
                                    }
                                }
                            }
                            ConflictResolution::Pending => {
                                conflicts += 1;
                                state_updates.push(SyncStateUpdate {
                                    file_path: change.relative_path.clone(),
                                    local_hash: local_meta.sha256.clone(),
                                    remote_hash: Some(remote_meta.sha256.clone()),
                                    sync_status: "conflict".to_string(),
                                    last_synced: 0,
                                    remote_fid: None,
                                    version: state.map(|s| s.version).unwrap_or(1),
                                    delete: false,
                                });
                            }
                        }
                    }
                }
            }
        }

        let completed_at = Utc::now();
        let result = SyncResult {
            total_changes,
            uploaded,
            downloaded,
            deleted,
            conflicts,
            errors,
            started_at,
            completed_at,
            state_updates,
        };

        tracing::info!(
            "Sync completed: {} up, {} down, {} del, {} conflicts, {} errors",
            uploaded, downloaded, deleted, conflicts, result.errors.len()
        );

        Ok(result)
    }

    /// Full pull: download all remote files that don't exist locally or have different hashes
    pub async fn full_pull(&self, sync_states: &HashMap<String, SyncStateInfo>) -> anyhow::Result<SyncResult> {
        let started_at = Utc::now();
        let mut errors = Vec::new();
        let mut downloaded = 0usize;
        let mut state_updates = Vec::new();

        tracing::info!("Starting full pull for vault: {:?}", self.vault_path);

        let local_files = ChangeDetector::scan_local(&self.vault_path, &self.config)?;
        let remote_metas = self.adapter.list_remote_files().await?;
        let remote_files: HashMap<String, FileMeta> = remote_metas
            .into_iter()
            .map(|m| (m.relative_path.clone(), m))
            .collect();

        let mut total_changes = 0;

        for (path, remote_meta) in &remote_files {
            let should_download = if let Some(local_meta) = local_files.get(path) {
                // File exists locally, check if different
                local_meta.sha256 != remote_meta.sha256
            } else {
                // File doesn't exist locally → download
                true
            };

            if should_download {
                total_changes += 1;
                match self.adapter.download_file(path).await {
                    Ok(content) => {
                        let local_path = self.vault_path.join(path);
                        if let Some(parent) = local_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        if let Err(e) = std::fs::write(&local_path, &content) {
                            errors.push(SyncError {
                                relative_path: path.clone(),
                                message: format!("Write local failed: {}", e),
                            });
                        } else {
                            downloaded += 1;
                            let hash = ChangeDetector::hash_content(&content);
                            state_updates.push(SyncStateUpdate {
                                file_path: path.clone(),
                                local_hash: hash.clone(),
                                remote_hash: Some(remote_meta.sha256.clone()),
                                sync_status: "synced".to_string(),
                                last_synced: Utc::now().timestamp(),
                                remote_fid: None,
                                version: sync_states.get(path).map(|s| s.version + 1).unwrap_or(1),
                                delete: false,
                            });
                        }
                    }
                    Err(e) => {
                        errors.push(SyncError {
                            relative_path: path.clone(),
                            message: format!("Download failed: {}", e),
                        });
                    }
                }
            }
        }

        let completed_at = Utc::now();
        let result = SyncResult {
            total_changes,
            uploaded: 0,
            downloaded,
            deleted: 0,
            conflicts: 0,
            errors,
            started_at,
            completed_at,
            state_updates,
        };

        tracing::info!("Full pull completed: {} downloaded, {} errors", downloaded, result.errors.len());
        Ok(result)
    }

    /// Get the sync config
    pub fn config(&self) -> &SyncConfig {
        &self.config
    }
}
