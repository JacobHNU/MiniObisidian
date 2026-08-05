pub mod baidu_adapter;
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
    /// Authoritative intent derived from mtime-based comparison.
    /// The sync engine executes based on this field.
    #[serde(default)]
    pub direction: ChangeDirection,
    pub local_meta: Option<FileMeta>,
    pub remote_meta: Option<FileMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChangeType {
    Added,      // exists locally but not remotely → upload
    Modified,   // exists in both but one side (or both) changed
    Deleted,    // exists remotely but not locally (local deleted) → delete remote
    Download,   // exists remotely but not locally (cross-device) → download
}

/// Intent for a change. The sync engine executes based on this.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub enum ChangeDirection {
    #[default]
    Upload,      // overwrite remote (rtype=3 style)
    Download,    // overwrite local
    DeleteRemote,
    Unresolved,  // both sides changed → conflict resolution needed
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
    /// Baseline: the exact cloud server_mtime captured after the last successful sync.
    /// Used for mtime-based change detection to avoid clock skew between devices.
    pub last_synced_mtime: i64,
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

    /// Upload a file to remote storage.
    /// Returns the cloud server_mtime (unix seconds) captured by the remote after a successful
    /// write, or None if the backend doesn't expose it. This value is used as the sync baseline.
    async fn upload_file(&self, relative_path: &str, content: &[u8]) -> anyhow::Result<Option<i64>>;

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

    /// Three-way comparison: local vs remote vs sync_state.
    ///
    /// Uses a **mtime-first** strategy (industry standard for cloud sync):
    /// - The sync_state baseline (`last_synced_mtime`, the exact cloud server_mtime from the
    ///   last successful sync) is used to decide which side changed since then.
    /// - This avoids clock skew between devices: instead of comparing two wall-clocks directly,
    ///   each side is compared against the shared baseline captured from the cloud.
    /// - SHA-256 is used only as a fallback when no baseline exists (legacy rows / first sync).
    pub fn detect_changes_with_state(
        local: &HashMap<String, FileMeta>,
        remote: &HashMap<String, FileMeta>,
        sync_states: &HashMap<String, SyncStateInfo>,
    ) -> Vec<FileChange> {
        // Tolerance for mtime comparison (seconds). Absorbs sub-second rounding and minor
        // clock drift so files aren't spuriously re-synced.
        const MTIME_TOLERANCE: i64 = 5;

        let mut changes = Vec::new();
        let mut processed = std::collections::HashSet::new();

        // ── Check all local files ──────────────────────────────
        for (path, local_meta) in local {
            processed.insert(path.clone());

            if let Some(remote_meta) = remote.get(path) {
                // Local + Remote both exist
                let local_t = local_meta.modified.timestamp();
                let remote_t = remote_meta.modified.timestamp();

                if let Some(state) = sync_states.get(path) {
                    if state.last_synced_mtime > 0 {
                        // Has a cloud baseline → compare both sides against it
                        let local_newer = local_t > state.last_synced_mtime + MTIME_TOLERANCE;
                        let remote_newer = remote_t > state.last_synced_mtime + MTIME_TOLERANCE;

                        match (local_newer, remote_newer) {
                            (false, false) => continue, // neither changed → already synced
                            (true, false) => changes.push(FileChange {
                                relative_path: path.clone(),
                                change_type: ChangeType::Modified,
                                direction: ChangeDirection::Upload,
                                local_meta: Some(local_meta.clone()),
                                remote_meta: Some(remote_meta.clone()),
                            }),
                            (false, true) => changes.push(FileChange {
                                relative_path: path.clone(),
                                change_type: ChangeType::Modified,
                                direction: ChangeDirection::Download,
                                local_meta: Some(local_meta.clone()),
                                remote_meta: Some(remote_meta.clone()),
                            }),
                            (true, true) => changes.push(FileChange {
                                relative_path: path.clone(),
                                change_type: ChangeType::Modified,
                                direction: ChangeDirection::Unresolved,
                                local_meta: Some(local_meta.clone()),
                                remote_meta: Some(remote_meta.clone()),
                            }),
                        }
                    } else {
                        // Legacy state without baseline → fall back to hash comparison
                        Self::push_hash_based_change(&mut changes, path, local_meta, remote_meta, state);
                    }
                } else {
                    // No sync state: compare the two mtimes directly
                    if (local_t - remote_t).abs() <= MTIME_TOLERANCE {
                        // Times agree → hash fallback
                        if local_meta.sha256 != remote_meta.sha256 {
                            changes.push(FileChange {
                                relative_path: path.clone(),
                                change_type: ChangeType::Modified,
                                direction: ChangeDirection::Unresolved,
                                local_meta: Some(local_meta.clone()),
                                remote_meta: Some(remote_meta.clone()),
                            });
                        }
                    } else if local_t > remote_t {
                        // Local newer → overwrite remote
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Modified,
                            direction: ChangeDirection::Upload,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: Some(remote_meta.clone()),
                        });
                    } else {
                        // Remote newer → overwrite local
                        changes.push(FileChange {
                            relative_path: path.clone(),
                            change_type: ChangeType::Modified,
                            direction: ChangeDirection::Download,
                            local_meta: Some(local_meta.clone()),
                            remote_meta: Some(remote_meta.clone()),
                        });
                    }
                }
            } else {
                // Local only, no remote → upload
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Added,
                    direction: ChangeDirection::Upload,
                    local_meta: Some(local_meta.clone()),
                    remote_meta: None,
                });
            }
        }

        // ── Check remote files not yet processed ───────────────
        for (path, remote_meta) in remote {
            if processed.contains(path) {
                continue;
            }
            if local.contains_key(path) {
                continue; // already handled above
            }

            // Remote only, no local
            if sync_states.contains_key(path) {
                // Had sync state but the local file was deleted → delete remote
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Deleted,
                    direction: ChangeDirection::DeleteRemote,
                    local_meta: None,
                    remote_meta: Some(remote_meta.clone()),
                });
            } else {
                // No sync state, remote only → cross-device first sync → download!
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Download,
                    direction: ChangeDirection::Download,
                    local_meta: None,
                    remote_meta: Some(remote_meta.clone()),
                });
            }
        }

        // Sync_state entries that no longer exist in either local or remote
        // are orphaned → cleaned up by the caller (persist layer).

        changes
    }

    /// Hash-based fallback for legacy sync states without an mtime baseline.
    fn push_hash_based_change(
        changes: &mut Vec<FileChange>,
        path: &String,
        local_meta: &FileMeta,
        remote_meta: &FileMeta,
        state: &SyncStateInfo,
    ) {
        let remote_base = state.remote_hash.as_deref().unwrap_or(&state.local_hash);
        if local_meta.sha256 == remote_meta.sha256 {
            // Both same → already synced
            return;
        } else if local_meta.sha256 != state.local_hash && remote_meta.sha256 == remote_base {
            // Only local changed → upload
            changes.push(FileChange {
                relative_path: path.clone(),
                change_type: ChangeType::Modified,
                direction: ChangeDirection::Upload,
                local_meta: Some(local_meta.clone()),
                remote_meta: Some(remote_meta.clone()),
            });
        } else if remote_meta.sha256 != remote_base && local_meta.sha256 == state.local_hash {
            // Only remote changed → download
            changes.push(FileChange {
                relative_path: path.clone(),
                change_type: ChangeType::Modified,
                direction: ChangeDirection::Download,
                local_meta: Some(local_meta.clone()),
                remote_meta: Some(remote_meta.clone()),
            });
        } else {
            // Both changed → conflict
            changes.push(FileChange {
                relative_path: path.clone(),
                change_type: ChangeType::Modified,
                direction: ChangeDirection::Unresolved,
                local_meta: Some(local_meta.clone()),
                remote_meta: Some(remote_meta.clone()),
            });
        }
    }
}

/// Sync state info used for three-way comparison
#[derive(Debug, Clone)]
pub struct SyncStateInfo {
    pub local_hash: String,
    pub remote_hash: Option<String>,
    pub sync_status: String,
    pub version: i32,
    /// Baseline cloud server_mtime from the last successful sync (0 = unknown/legacy).
    pub last_synced_mtime: i64,
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

        // 4. Execute sync operations (based on ChangeDirection intent)
        for change in &changes {
            match change.direction {
                ChangeDirection::Upload => {
                    // Read local file and upload (overwrite remote)
                    let local_path = self.vault_path.join(&change.relative_path);
                    let content = match std::fs::read(&local_path) {
                        Ok(c) => c,
                        Err(e) => {
                            errors.push(SyncError {
                                relative_path: change.relative_path.clone(),
                                message: format!("Read local file failed: {}", e),
                            });
                            continue;
                        }
                    };

                    let remote_mtime = match self.adapter.upload_file(&change.relative_path, &content).await {
                        Ok(m) => m,
                        Err(e) => {
                            tracing::error!("Failed to upload {}: {}", change.relative_path, e);
                            errors.push(SyncError {
                                relative_path: change.relative_path.clone(),
                                message: format!("Upload failed: {}", e),
                            });
                            continue;
                        }
                    };

                    uploaded += 1;
                    let hash = ChangeDetector::hash_content(&content);
                    // Baseline = the exact cloud server_mtime returned by the API (avoids clock skew)
                    let baseline = remote_mtime.unwrap_or_else(|| Utc::now().timestamp());
                    let version = sync_states.get(&change.relative_path).map(|s| s.version + 1).unwrap_or(1);
                    state_updates.push(SyncStateUpdate {
                        file_path: change.relative_path.clone(),
                        local_hash: hash.clone(),
                        remote_hash: Some(hash),
                        sync_status: "synced".to_string(),
                        last_synced: Utc::now().timestamp(),
                        last_synced_mtime: baseline,
                        remote_fid: None,
                        version,
                        delete: false,
                    });
                    tracing::debug!("Uploaded: {}", change.relative_path);
                }
                ChangeDirection::Download => {
                    match self.adapter.download_file(&change.relative_path).await {
                        Ok(content) => {
                            let local_path = self.vault_path.join(&change.relative_path);
                            if let Some(parent) = local_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            if let Err(e) = std::fs::write(&local_path, &content) {
                                errors.push(SyncError {
                                    relative_path: change.relative_path.clone(),
                                    message: format!("Write local failed: {}", e),
                                });
                                continue;
                            }
                            downloaded += 1;
                            let hash = ChangeDetector::hash_content(&content);
                            // Baseline = the remote server_mtime from the downloaded file metadata
                            let baseline = change.remote_meta.as_ref()
                                .map(|m| m.modified.timestamp())
                                .unwrap_or_else(|| Utc::now().timestamp());
                            let version = sync_states.get(&change.relative_path).map(|s| s.version + 1).unwrap_or(1);
                            state_updates.push(SyncStateUpdate {
                                file_path: change.relative_path.clone(),
                                local_hash: hash.clone(),
                                remote_hash: Some(hash),
                                sync_status: "synced".to_string(),
                                last_synced: Utc::now().timestamp(),
                                last_synced_mtime: baseline,
                                remote_fid: None,
                                version,
                                delete: false,
                            });
                        }
                        Err(e) => {
                            errors.push(SyncError {
                                relative_path: change.relative_path.clone(),
                                message: format!("Download failed: {}", e),
                            });
                        }
                    }
                }
                ChangeDirection::DeleteRemote => {
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
                            last_synced_mtime: 0,
                            remote_fid: None,
                            version: 0,
                            delete: true,
                        });
                        tracing::debug!("Deleted remote: {}", change.relative_path);
                    }
                }
                ChangeDirection::Unresolved => {
                    // Both sides changed → conflict resolution
                    let local_meta = match change.local_meta.as_ref() {
                        Some(m) => m,
                        None => {
                            tracing::warn!("Conflict change missing local_meta: {}", change.relative_path);
                            continue;
                        }
                    };
                    let remote_meta = match change.remote_meta.as_ref() {
                        Some(m) => m,
                        None => {
                            tracing::warn!("Conflict change missing remote_meta: {}", change.relative_path);
                            continue;
                        }
                    };

                    let state = sync_states.get(&change.relative_path);
                    let resolution = self.conflict_resolver.resolve(local_meta, remote_meta);

                    match resolution {
                        ConflictResolution::KeepLocal => {
                            let local_path = self.vault_path.join(&change.relative_path);
                            if let Ok(content) = std::fs::read(&local_path) {
                                match self.adapter.upload_file(&change.relative_path, &content).await {
                                    Ok(remote_mtime) => {
                                        uploaded += 1;
                                        let hash = ChangeDetector::hash_content(&content);
                                        let baseline = remote_mtime.unwrap_or_else(|| Utc::now().timestamp());
                                        state_updates.push(SyncStateUpdate {
                                            file_path: change.relative_path.clone(),
                                            local_hash: hash.clone(),
                                            remote_hash: Some(hash),
                                            sync_status: "synced".to_string(),
                                            last_synced: Utc::now().timestamp(),
                                            last_synced_mtime: baseline,
                                            remote_fid: None,
                                            version: state.map(|s| s.version + 1).unwrap_or(1),
                                            delete: false,
                                        });
                                    }
                                    Err(e) => {
                                        errors.push(SyncError {
                                            relative_path: change.relative_path.clone(),
                                            message: format!("Upload failed: {}", e),
                                        });
                                    }
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
                                        let baseline = remote_meta.modified.timestamp();
                                        state_updates.push(SyncStateUpdate {
                                            file_path: change.relative_path.clone(),
                                            local_hash: hash.clone(),
                                            remote_hash: Some(hash),
                                            sync_status: "synced".to_string(),
                                            last_synced: Utc::now().timestamp(),
                                            last_synced_mtime: baseline,
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
                                    let baseline = remote_meta.modified.timestamp();
                                    state_updates.push(SyncStateUpdate {
                                        file_path: change.relative_path.clone(),
                                        local_hash: hash.clone(),
                                        remote_hash: Some(hash),
                                        sync_status: "synced".to_string(),
                                        last_synced: Utc::now().timestamp(),
                                        last_synced_mtime: baseline,
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
                                last_synced_mtime: state.map(|s| s.last_synced_mtime).unwrap_or(0),
                                remote_fid: None,
                                version: state.map(|s| s.version).unwrap_or(1),
                                delete: false,
                            });
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
                            // Baseline = remote server_mtime (exact cloud time)
                            let baseline = remote_meta.modified.timestamp();
                            state_updates.push(SyncStateUpdate {
                                file_path: path.clone(),
                                local_hash: hash.clone(),
                                remote_hash: Some(remote_meta.sha256.clone()),
                                sync_status: "synced".to_string(),
                                last_synced: Utc::now().timestamp(),
                                last_synced_mtime: baseline,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// The mtime-first change detection lives on ChangeDetector.
    /// Alias so tests read naturally.
    type SyncEngine = ChangeDetector;

    fn meta(path: &str, mtime: i64, hash: &str) -> FileMeta {
        FileMeta {
            relative_path: path.to_string(),
            sha256: hash.to_string(),
            size: 0,
            modified: DateTime::from_timestamp(mtime, 0).unwrap(),
            last_synced: None,
        }
    }

    fn state(baseline: i64) -> SyncStateInfo {
        SyncStateInfo {
            local_hash: String::new(),
            remote_hash: None,
            sync_status: "synced".to_string(),
            version: 1,
            last_synced_mtime: baseline,
        }
    }

    fn directions(changes: &[FileChange]) -> Vec<ChangeDirection> {
        changes.iter().map(|c| c.direction).collect()
    }

    /// Cross-device first sync: remote has a file, local doesn't, no sync_state.
    /// MUST be Download (NOT Deleted) — otherwise remote files would be destroyed.
    #[test]
    fn cross_device_first_sync_is_download() {
        let local: HashMap<String, FileMeta> = HashMap::new();
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "r"))]);
        let states: HashMap<String, SyncStateInfo> = HashMap::new();

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_type, ChangeType::Download);
        assert_eq!(changes[0].direction, ChangeDirection::Download);
    }

    /// Local file deleted while remote intact and has sync_state → delete remote.
    #[test]
    fn local_deleted_with_state_deletes_remote() {
        let local: HashMap<String, FileMeta> = HashMap::new();
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "r"))]);
        let states: HashMap<String, SyncStateInfo> =
            HashMap::from([("notes/a.md".to_string(), state(1_699_000_000))]);

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_type, ChangeType::Deleted);
        assert_eq!(changes[0].direction, ChangeDirection::DeleteRemote);
    }

    /// Local newer than baseline, remote unchanged → upload (overwrite remote).
    #[test]
    fn local_newer_than_baseline_uploads() {
        let baseline = 1_700_000_000;
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline + 100, "l1"))]);
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline, "r1"))]);
        let states: HashMap<String, SyncStateInfo> =
            HashMap::from([("notes/a.md".to_string(), state(baseline))]);

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert_eq!(directions(&changes), vec![ChangeDirection::Upload]);
        assert_eq!(changes[0].change_type, ChangeType::Modified);
    }

    /// Remote newer than baseline, local unchanged → download (overwrite local).
    #[test]
    fn remote_newer_than_baseline_downloads() {
        let baseline = 1_700_000_000;
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline, "l1"))]);
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline + 200, "r2"))]);
        let states: HashMap<String, SyncStateInfo> =
            HashMap::from([("notes/a.md".to_string(), state(baseline))]);

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert_eq!(directions(&changes), vec![ChangeDirection::Download]);
    }

    /// Both sides changed since baseline → unresolved conflict.
    #[test]
    fn both_changed_since_baseline_is_conflict() {
        let baseline = 1_700_000_000;
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline + 100, "l2"))]);
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline + 200, "r2"))]);
        let states: HashMap<String, SyncStateInfo> =
            HashMap::from([("notes/a.md".to_string(), state(baseline))]);

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert_eq!(directions(&changes), vec![ChangeDirection::Unresolved]);
    }

    /// Neither side changed since baseline → no change (already synced).
    #[test]
    fn unchanged_since_baseline_is_skipped() {
        let baseline = 1_700_000_000;
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline, "l1"))]);
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", baseline - 3, "r1"))]);
        let states: HashMap<String, SyncStateInfo> =
            HashMap::from([("notes/a.md".to_string(), state(baseline))]);

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert!(changes.is_empty());
    }

    /// No baseline: compare local vs remote mtimes directly.
    /// Local newer → upload; remote newer → download.
    #[test]
    fn no_baseline_compares_mtimes_directly() {
        // Local newer
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "l"))]);
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_600_000_000, "r"))]);
        let states: HashMap<String, SyncStateInfo> = HashMap::new();

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);
        assert_eq!(directions(&changes), vec![ChangeDirection::Upload]);

        // Remote newer
        let local2: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_500_000_000, "l"))]);
        let remote2: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "r"))]);
        let changes2 = SyncEngine::detect_changes_with_state(&local2, &remote2, &HashMap::new());
        assert_eq!(directions(&changes2), vec![ChangeDirection::Download]);
    }

    /// No baseline, same mtime, same hash → skip.
    /// No baseline, same mtime, different hash → unresolved (hash fallback).
    #[test]
    fn no_baseline_same_mtime_uses_hash() {
        // Same hash → skipped
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "same"))]);
        let remote: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "same"))]);
        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &HashMap::new());
        assert!(changes.is_empty());

        // Different hash → unresolved
        let local2: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "l"))]);
        let remote2: HashMap<String, FileMeta> =
            HashMap::from([("notes/a.md".to_string(), meta("notes/a.md", 1_700_000_000, "r"))]);
        let changes2 = SyncEngine::detect_changes_with_state(&local2, &remote2, &HashMap::new());
        assert_eq!(directions(&changes2), vec![ChangeDirection::Unresolved]);
    }

    /// New local file (no remote, no state) → Added / Upload.
    #[test]
    fn new_local_file_uploads() {
        let local: HashMap<String, FileMeta> =
            HashMap::from([("notes/new.md".to_string(), meta("notes/new.md", 1_700_000_000, "l"))]);
        let remote: HashMap<String, FileMeta> = HashMap::new();
        let states: HashMap<String, SyncStateInfo> = HashMap::new();

        let changes = SyncEngine::detect_changes_with_state(&local, &remote, &states);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_type, ChangeType::Added);
        assert_eq!(changes[0].direction, ChangeDirection::Upload);
    }
}
