use std::path::PathBuf;
use chrono::{DateTime, Utc};
use crate::{FileMeta, SyncAdapter};

/// Local filesystem sync adapter.
/// Syncs vault to another local folder (e.g. a cloud-synced directory like Baidu Netdisk local folder).
/// This serves as both a practical adapter and a reference implementation for cloud adapters.
pub struct LocalSyncAdapter {
    sync_target: PathBuf,
}

impl LocalSyncAdapter {
    pub fn new(sync_target: PathBuf) -> Self {
        Self { sync_target }
    }

    fn target_path(&self, relative_path: &str) -> PathBuf {
        self.sync_target.join(relative_path)
    }
}

#[async_trait::async_trait]
impl SyncAdapter for LocalSyncAdapter {
    async fn list_remote_files(&self) -> anyhow::Result<Vec<FileMeta>> {
        let target = &self.sync_target;
        if !target.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(target)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.')
            })
        {
            let entry = entry?;
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let relative = path
                .strip_prefix(target)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();

            if !relative.ends_with(".md") && !relative.starts_with("attachments/") {
                continue;
            }

            let content = std::fs::read(path)?;
            let meta = entry.metadata()?;
            let modified: DateTime<Utc> = meta.modified()
                .map(|t| t.into())
                .unwrap_or_else(|_| Utc::now());

            files.push(FileMeta {
                relative_path: relative,
                sha256: crate::ChangeDetector::hash_content(&content),
                size: content.len() as u64,
                modified,
                last_synced: None,
            });
        }

        Ok(files)
    }

    async fn download_file(&self, relative_path: &str) -> anyhow::Result<Vec<u8>> {
        let path = self.target_path(relative_path);
        if !path.exists() {
            anyhow::bail!("File not found on remote: {}", relative_path);
        }
        Ok(std::fs::read(path)?)
    }

    async fn upload_file(&self, relative_path: &str, content: &[u8]) -> anyhow::Result<()> {
        let path = self.target_path(relative_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, content)?;
        Ok(())
    }

    async fn delete_remote_file(&self, relative_path: &str) -> anyhow::Result<()> {
        let path = self.target_path(relative_path);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.sync_target.exists()
    }

    fn adapter_name(&self) -> &str {
        "Local Folder"
    }
}
