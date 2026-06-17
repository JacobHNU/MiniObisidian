pub mod local_adapter;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use chrono::{DateTime, Utc};
use sha2::{Sha256, Digest};

// ──────────────────────────────────────────────
// Core Types
// ──────────────────────────────────────────────

/// Represents a single file's metadata for sync tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMeta {
    pub relative_path: String,
    pub sha256: String,
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub last_synced: Option<DateTime<Utc>>,
}

/// Change detected during scan
#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct SyncResult {
    pub total_changes: usize,
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub conflicts: usize,
    pub errors: Vec<SyncError>,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncError {
    pub relative_path: String,
    pub message: String,
}

/// Overall sync status
#[derive(Debug, Clone, Serialize, Deserialize)]
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

    /// Scan local directory and build file metadata map
    pub fn scan_local(vault_path: &Path) -> anyhow::Result<HashMap<String, FileMeta>> {
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

            // Only sync .md files and attachments
            if !relative.ends_with(".md") && !relative.starts_with("attachments/") {
                continue;
            }

            let content = std::fs::read(path)?;
            let meta = entry.metadata()?;
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

    /// Compare local and remote file maps, produce list of changes
    pub fn detect_changes(
        local: &HashMap<String, FileMeta>,
        remote: &HashMap<String, FileMeta>,
    ) -> Vec<FileChange> {
        let mut changes = Vec::new();

        // Files in local but not remote → Added
        for (path, meta) in local {
            if !remote.contains_key(path) {
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Added,
                    local_meta: Some(meta.clone()),
                    remote_meta: None,
                });
            }
        }

        // Files in remote but not local → Deleted
        for (path, meta) in remote {
            if !local.contains_key(path) {
                changes.push(FileChange {
                    relative_path: path.clone(),
                    change_type: ChangeType::Deleted,
                    local_meta: None,
                    remote_meta: Some(meta.clone()),
                });
            }
        }

        // Files in both → check hash
        for (path, local_meta) in local {
            if let Some(remote_meta) = remote.get(path) {
                if local_meta.sha256 != remote_meta.sha256 {
                    changes.push(FileChange {
                        relative_path: path.clone(),
                        change_type: ChangeType::Modified,
                        local_meta: Some(local_meta.clone()),
                        remote_meta: Some(remote_meta.clone()),
                    });
                }
            }
        }

        changes
    }
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
    sync_history: Vec<SyncResult>,
}

impl SyncEngine {
    pub fn new(
        vault_path: PathBuf,
        adapter: Box<dyn SyncAdapter>,
        conflict_strategy: ConflictStrategy,
    ) -> Self {
        Self {
            vault_path,
            adapter,
            conflict_resolver: ConflictResolver::new(conflict_strategy),
            sync_history: Vec::new(),
        }
    }

    /// Run a full sync cycle: scan → detect → plan → execute
    pub async fn sync(&mut self) -> anyhow::Result<SyncResult> {
        let started_at = Utc::now();
        let mut errors = Vec::new();
        let mut uploaded = 0usize;
        let mut downloaded = 0usize;
        let mut deleted = 0usize;
        let mut conflicts = 0usize;

        tracing::info!("Starting sync for vault: {:?}", self.vault_path);

        // 1. Scan local files
        let local_files = ChangeDetector::scan_local(&self.vault_path)?;

        // 2. Get remote files
        let remote_metas = self.adapter.list_remote_files().await?;
        let remote_files: HashMap<String, FileMeta> = remote_metas
            .into_iter()
            .map(|m| (m.relative_path.clone(), m))
            .collect();

        // 3. Detect changes
        let changes = ChangeDetector::detect_changes(&local_files, &remote_files);
        let total_changes = changes.len();

        tracing::info!("Detected {} changes", total_changes);

        // 4. Execute sync operations
        for change in &changes {
            match change.change_type {
                ChangeType::Added => {
                    // Upload new local file
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
                    // Delete from remote
                    if let Err(e) = self.adapter.delete_remote_file(&change.relative_path).await {
                        tracing::error!("Failed to delete remote {}: {}", change.relative_path, e);
                        errors.push(SyncError {
                            relative_path: change.relative_path.clone(),
                            message: format!("Remote delete failed: {}", e),
                        });
                    } else {
                        deleted += 1;
                        tracing::debug!("Deleted remote: {}", change.relative_path);
                    }
                }
                ChangeType::Modified => {
                    // Conflict: both sides changed
                    let local_meta = change.local_meta.as_ref().unwrap();
                    let remote_meta = change.remote_meta.as_ref().unwrap();
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
                            // Backup local, download remote, save local backup with suffix
                            let local_path = self.vault_path.join(&change.relative_path);
                            let backup_name = format!(
                                "{}.conflict-{}",
                                change.relative_path,
                                Utc::now().format("%Y%m%d-%H%M%S")
                            );
                            let backup_path = self.vault_path.join(&backup_name);

                            // Save local as backup
                            if let Ok(content) = std::fs::read(&local_path) {
                                let _ = std::fs::create_dir_all(backup_path.parent().unwrap());
                                let _ = std::fs::write(&backup_path, &content);
                            }

                            // Download remote as current
                            match self.adapter.download_file(&change.relative_path).await {
                                Ok(content) => {
                                    let _ = std::fs::write(&local_path, &content);
                                    downloaded += 1;
                                    conflicts += 1;
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
        };

        self.sync_history.push(result.clone());
        tracing::info!(
            "Sync completed: {} up, {} down, {} del, {} conflicts, {} errors",
            uploaded, downloaded, deleted, conflicts, result.errors.len()
        );

        Ok(result)
    }

    /// Get current sync status
    pub fn status(&self) -> SyncStatus {
        SyncStatus {
            is_syncing: false,
            last_sync: self.sync_history.last().map(|r| r.completed_at),
            last_result: self.sync_history.last().cloned(),
            pending_changes: 0,
            sync_dir: Some(self.vault_path.to_string_lossy().to_string()),
        }
    }

    /// Get sync history
    pub fn history(&self) -> &[SyncResult] {
        &self.sync_history
    }
}
