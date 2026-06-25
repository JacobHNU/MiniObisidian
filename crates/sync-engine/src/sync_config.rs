use serde::{Deserialize, Serialize};

/// Configuration for sync behavior and file filtering
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    /// File patterns to include (glob-style). Default: ["*.md", "attachments/*"]
    pub include_patterns: Vec<String>,
    /// File patterns to exclude (glob-style). Default: []
    pub exclude_patterns: Vec<String>,
    /// Maximum file size in bytes. 0 = no limit. Default: 10MB
    pub max_file_size: u64,
    /// Directory names to exclude. Default: ["node_modules", ".git"]
    pub exclude_dirs: Vec<String>,
    /// Auto-sync enabled. Default: false
    pub auto_sync_enabled: bool,
    /// Auto-sync interval in minutes. Default: 5
    pub auto_sync_interval_minutes: u32,
    /// Check network before sync. Default: true
    pub check_network: bool,
    /// Conflict resolution strategy. Default: "keep_newer"
    pub conflict_strategy: String,
    /// Sync target directory path
    pub sync_target: String,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            include_patterns: vec!["*.md".to_string(), "attachments/*".to_string()],
            exclude_patterns: Vec::new(),
            max_file_size: 10 * 1024 * 1024, // 10MB
            exclude_dirs: vec!["node_modules".to_string(), ".git".to_string()],
            auto_sync_enabled: false,
            auto_sync_interval_minutes: 5,
            check_network: true,
            conflict_strategy: "keep_newer".to_string(),
            sync_target: String::new(),
        }
    }
}

impl SyncConfig {
    /// Serialize to JSON string for storage
    pub fn to_json(&self) -> anyhow::Result<String> {
        Ok(serde_json::to_string(self)?)
    }

    /// Deserialize from JSON string
    pub fn from_json(json: &str) -> anyhow::Result<Self> {
        Ok(serde_json::from_str(json)?)
    }

    /// Check if a relative path should be synced based on include/exclude rules
    pub fn should_sync(&self, relative_path: &str) -> bool {
        // Check excluded directories
        for dir in &self.exclude_dirs {
            if relative_path.starts_with(&format!("{}/", dir)) || relative_path.contains(&format!("/{}/", dir)) {
                return false;
            }
        }

        // Check excluded patterns
        for pattern in &self.exclude_patterns {
            if matches_pattern(relative_path, pattern) {
                return false;
            }
        }

        // Check included patterns
        if self.include_patterns.is_empty() {
            return true;
        }
        for pattern in &self.include_patterns {
            if matches_pattern(relative_path, pattern) {
                return true;
            }
        }

        false
    }
}

/// Simple glob-like pattern matching
/// Supports: *.ext, prefix/*, exact match
fn matches_pattern(path: &str, pattern: &str) -> bool {
    if pattern.starts_with("*.") {
        // Extension match: "*.md" matches "foo/bar.md"
        let ext = &pattern[1..]; // ".md"
        return path.ends_with(ext);
    }
    if pattern.ends_with("/*") {
        // Prefix match: "attachments/*" matches "attachments/img.png"
        let prefix = &pattern[..pattern.len() - 1]; // "attachments/"
        return path.starts_with(prefix);
    }
    // Exact match
    path == pattern
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SyncConfig::default();
        assert!(config.should_sync("notes/daily.md"));
        assert!(config.should_sync("attachments/image.png"));
        assert!(!config.should_sync("node_modules/package.json"));
        assert!(!config.should_sync("subdir/node_modules/foo.md"));
    }

    #[test]
    fn test_exclude_patterns() {
        let mut config = SyncConfig::default();
        config.exclude_patterns.push("*.pdf".to_string());
        assert!(config.should_sync("notes/test.md"));
        assert!(!config.should_sync("notes/test.pdf"));
    }

    #[test]
    fn test_json_roundtrip() {
        let config = SyncConfig::default();
        let json = config.to_json().unwrap();
        let restored = SyncConfig::from_json(&json).unwrap();
        assert_eq!(restored.include_patterns, config.include_patterns);
        assert_eq!(restored.max_file_size, config.max_file_size);
    }
}
