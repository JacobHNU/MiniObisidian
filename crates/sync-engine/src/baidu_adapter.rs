use std::path::Path;
use anyhow::{Result, Context};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::{FileMeta, SyncAdapter};

/// Simple percent-encoding for URLs (RFC 3986 unreserved characters)
fn percent_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push('%');
                result.push_str(&format!("{:02X}", byte));
            }
        }
    }
    result
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/// Baidu Pan OAuth2.0 authorization endpoint
const BAIDU_AUTH_URL: &str = "https://openapi.baidu.com/oauth/2.0/authorize";
/// Baidu Pan OAuth2.0 token endpoint
const BAIDU_TOKEN_URL: &str = "https://openapi.baidu.com/oauth/2.0/token";
/// Baidu Pan REST API base URL
const BAIDU_API_BASE: &str = "https://d.pcs.baidu.com/rest/2.0/xpan";
/// Baidu Pan file management API
const BAIDU_FILE_API: &str = "https://pan.baidu.com/rest/2.0/xpan";
/// Baidu Pan user info API
const BAIDU_USER_INFO: &str = "https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo";
/// Remote root directory for this app
const REMOTE_ROOT: &str = "/apps/MiniObsidian";

// ──────────────────────────────────────────────
// OAuth2.0 Token Response
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaiduToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub scope: String,
    #[serde(default)]
    pub created_at: i64,
}

impl BaiduToken {
    /// Check if the access token has expired (with 5-minute buffer)
    pub fn is_expired(&self) -> bool {
        let now = Utc::now().timestamp();
        now > (self.created_at + self.expires_in - 300)
    }
}

// ──────────────────────────────────────────────
// Baidu API Response Types
// ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct BaiduListResponse {
    list: Option<Vec<BaiduFileInfo>>,
    errno: Option<i32>,
    errmsg: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BaiduFileInfo {
    #[serde(default)]
    fs_id: u64,
    path: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    isdir: u8,
    #[serde(default)]
    server_mtime: i64,
    #[serde(default)]
    server_ctime: i64,
    #[serde(default)]
    md5: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BaiduPreCreateResponse {
    errno: Option<i32>,
    #[serde(default)]
    return_type: u8,  // 1=rapid upload success, 2=need upload
    #[serde(default)]
    block_list: Vec<u32>,
    #[serde(default)]
    uploadid: String,
}

#[derive(Debug, Deserialize)]
struct BaiduUploadResponse {
    errno: Option<i32>,
    #[serde(default)]
    md5: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BaiduCreateResponse {
    errno: Option<i32>,
    #[serde(default)]
    fs_id: u64,
    #[serde(default)]
    path: String,
    #[serde(default)]
    size: u64,
    /// Cloud server_mtime captured by the API after create (unix seconds).
    /// Used as the sync baseline to avoid clock skew between devices.
    #[serde(default)]
    mtime: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BaiduUserInfo {
    pub errno: Option<i32>,
    #[serde(default)]
    pub baidu_name: String,
    #[serde(default)]
    pub netdisk_name: String,
    #[serde(default)]
    pub vip_type: u32,
    #[serde(default)]
    pub total_space: u64,
    #[serde(default)]
    pub used_space: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BaiduQuotaResponse {
    errno: Option<i32>,
    #[serde(default)]
    total: u64,
    #[serde(default)]
    used: u64,
    #[serde(default)]
    free: u64,
}

// ──────────────────────────────────────────────
// Baidu Pan Sync Adapter
// ──────────────────────────────────────────────

/// Baidu Pan sync adapter.
/// Implements direct API synchronization with Baidu Pan (百度网盘).
///
/// Uses OAuth2.0 for authorization and Baidu PCS REST API for file operations.
/// The adapter stores files under `/apps/MiniObsidian/` on Baidu Pan.
#[derive(Clone)]
pub struct BaiduAdapter {
    client: Client,
    token: Option<BaiduToken>,
    app_key: String,
    secret_key: String,
}

impl BaiduAdapter {
    pub fn new(app_key: String, secret_key: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            token: None,
            app_key,
            secret_key,
        }
    }

    /// Create adapter with existing token
    pub fn with_token(app_key: String, secret_key: String, token: BaiduToken) -> Self {
        let mut adapter = Self::new(app_key, secret_key);
        adapter.token = Some(token);
        adapter
    }

    /// Get the OAuth2.0 authorization URL.
    /// The user should open this URL in a browser to authorize the app.
    pub fn get_auth_url(&self, redirect_uri: &str) -> String {
        format!(
            "{}?client_id={}&response_type=code&redirect_uri={}&scope=basic,netdisk&display=page",
            BAIDU_AUTH_URL, self.app_key, percent_encode(redirect_uri)
        )
    }

    /// Exchange authorization code for access token
    pub async fn exchange_code(&mut self, code: &str, redirect_uri: &str) -> Result<BaiduToken> {
        let url = format!(
            "{}?grant_type=authorization_code&code={}&client_id={}&client_secret={}&redirect_uri={}",
            BAIDU_TOKEN_URL, code, self.app_key, self.secret_key, percent_encode(redirect_uri)
        );

        let resp = self.client.get(&url).send().await
            .context("Failed to connect to Baidu OAuth server")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OAuth token request failed ({}): {}", status, body);
        }

        let token_resp: serde_json::Value = resp.json().await
            .context("Failed to parse OAuth response")?;

        if let Some(error) = token_resp.get("error") {
            anyhow::bail!("OAuth error: {}", error);
        }

        let access_token = token_resp["access_token"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing access_token in response"))?
            .to_string();
        let refresh_token = token_resp["refresh_token"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing refresh_token in response"))?
            .to_string();
        let expires_in = token_resp["expires_in"].as_i64()
            .ok_or_else(|| anyhow::anyhow!("Missing expires_in in response"))?;
        let scope = token_resp["scope"].as_str().unwrap_or("").to_string();

        let token = BaiduToken {
            access_token,
            refresh_token,
            expires_in,
            scope,
            created_at: Utc::now().timestamp(),
        };

        self.token = Some(token.clone());
        info!("Baidu Pan OAuth: successfully obtained access token");
        Ok(token)
    }

    /// Refresh the access token using the refresh token
    pub async fn refresh_token(&mut self) -> Result<BaiduToken> {
        let old_token = self.token.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No refresh token available"))?;

        let url = format!(
            "{}?grant_type=refresh_token&refresh_token={}&client_id={}&client_secret={}",
            BAIDU_TOKEN_URL, old_token.refresh_token, self.app_key, self.secret_key
        );

        let resp = self.client.get(&url).send().await
            .context("Failed to connect to Baidu OAuth server")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Token refresh failed ({}): {}", status, body);
        }

        let token_resp: serde_json::Value = resp.json().await
            .context("Failed to parse refresh response")?;

        if let Some(error) = token_resp.get("error") {
            anyhow::bail!("Token refresh error: {}", error);
        }

        let access_token = token_resp["access_token"].as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing access_token in refresh response"))?
            .to_string();
        let refresh_token = token_resp["refresh_token"].as_str()
            .unwrap_or(&old_token.refresh_token)
            .to_string();
        let expires_in = token_resp["expires_in"].as_i64().unwrap_or(2592000);
        let scope = token_resp["scope"].as_str().unwrap_or("").to_string();

        let new_token = BaiduToken {
            access_token,
            refresh_token,
            expires_in,
            scope,
            created_at: Utc::now().timestamp(),
        };

        self.token = Some(new_token.clone());
        info!("Baidu Pan OAuth: token refreshed successfully");
        Ok(new_token)
    }

    /// Set token directly (e.g., loaded from persistent storage)
    pub fn set_token(&mut self, token: BaiduToken) {
        self.token = Some(token);
    }

    /// Get current token (for persistence)
    pub fn get_token(&self) -> Option<&BaiduToken> {
        self.token.as_ref()
    }

    /// Clear stored token (logout)
    pub fn clear_token(&mut self) {
        self.token = None;
        info!("Baidu Pan: token cleared");
    }

    /// Ensure we have a valid token, refreshing if needed
    async fn ensure_token(&self) -> Result<&BaiduToken> {
        let token = self.token.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Not authenticated. Please authorize first."))?;

        if token.is_expired() {
            // Token is expired - caller should call refresh_token() first
            warn!("Baidu Pan access token is expired");
            anyhow::bail!("Access token expired. Please refresh token.");
        }

        Ok(token)
    }

    /// Get the remote path for a relative path
    fn remote_path(&self, relative_path: &str) -> String {
        format!("{}/{}", REMOTE_ROOT, relative_path.replace('\\', "/"))
    }

    /// Get the relative path from a remote path
    fn relative_path(&self, remote_path: &str) -> Option<String> {
        remote_path.strip_prefix(&format!("{}/", REMOTE_ROOT))
            .map(|s| s.to_string())
    }

    /// Check connection and get user info
    pub async fn get_user_info(&self) -> Result<BaiduUserInfo> {
        let token = self.ensure_token().await?;

        let resp = self.client.get(BAIDU_USER_INFO)
            .query(&[("access_token", &token.access_token)])
            .send().await
            .context("Failed to connect to Baidu Pan")?;

        let info: BaiduUserInfo = resp.json().await
            .context("Failed to parse user info")?;

        if let Some(errno) = info.errno {
            if errno != 0 {
                anyhow::bail!("Baidu API error {}: user info failed", errno);
            }
        }

        Ok(info)
    }

    /// Get storage quota info
    pub async fn get_quota(&self) -> Result<(u64, u64)> {
        let token = self.ensure_token().await?;

        let resp = self.client.get(format!("{}/file?method=uinfo", BAIDU_FILE_API))
            .query(&[("access_token", &token.access_token)])
            .send().await
            .context("Failed to get quota")?;

        let info: serde_json::Value = resp.json().await
            .context("Failed to parse quota response")?;

        let total = info["total"].as_u64().unwrap_or(0);
        let used = info["used"].as_u64().unwrap_or(0);

        Ok((total, used))
    }

    /// List files in a remote directory (recursive)
    async fn list_dir_recursive(&self, dir: &str) -> Result<Vec<BaiduFileInfo>> {
        let token = self.ensure_token().await?;
        let mut all_files = Vec::new();
        self.list_dir_internal(&token.access_token, dir, &mut all_files).await?;
        Ok(all_files)
    }

    /// Internal recursive directory listing
    async fn list_dir_internal(&self, access_token: &str, dir: &str, all_files: &mut Vec<BaiduFileInfo>) -> Result<()> {
        let mut page = 1u32;
        loop {
            let resp = self.client.get(format!("{}/file?method=list", BAIDU_FILE_API))
                .query(&[
                    ("access_token", access_token),
                    ("dir", dir),
                    ("web", "1"),
                    ("page", &page.to_string()),
                    ("num", "1000"),
                    ("order", "time"),
                ])
                .send().await
                .context("Failed to list remote files")?;

            let body = resp.text().await.context("Failed to read list response")?;
            let list_resp: BaiduListResponse = serde_json::from_str(&body)
                .context(format!("Failed to parse list response: {}", &body[..body.len().min(200)]))?;

            if let Some(errno) = list_resp.errno {
                if errno != 0 {
                    // errno -9 means directory doesn't exist yet
                    if errno == -9 {
                        return Ok(());
                    }
                    anyhow::bail!("Baidu API error {}: {}", errno, list_resp.errmsg.unwrap_or_default());
                }
            }

            if let Some(files) = list_resp.list {
                let count = files.len();
                for f in files {
                    if f.isdir == 1 {
                        // Recurse into subdirectory
                        Box::pin(self.list_dir_internal(access_token, &f.path, all_files)).await?;
                    } else {
                        all_files.push(f);
                    }
                }
                if count < 1000 {
                    break;
                }
            } else {
                break;
            }
            page += 1;
        }
        Ok(())
    }

    /// Create remote directory (mkdir -p style)
    async fn ensure_remote_dir(&self, remote_path: &str) -> Result<()> {
        let token = self.ensure_token().await?;

        // Build directory path by creating each parent
        let parts: Vec<&str> = remote_path.trim_start_matches('/').split('/').collect();
        let mut current = String::new();
        for part in &parts {
            current.push('/');
            current.push_str(part);
            // Try to create each directory level
            let isdir = "1".to_string();
            let resp = self.client.post(format!("{}/file?method=create", BAIDU_FILE_API))
                .query(&[
                    ("access_token", &token.access_token),
                    ("path", &current),
                    ("isdir", &isdir),
                ])
                .send().await;

            match resp {
                Ok(r) => {
                    let body = r.text().await.unwrap_or_default();
                    // errno 0 = success, -8 already exists = ok
                    if body.contains("\"errno\":0") || body.contains("\"errno\":-8") {
                        // OK
                    } else {
                        warn!("mkdir {} response: {}", current, body);
                    }
                }
                Err(e) => {
                    warn!("mkdir {} failed: {}", current, e);
                }
            }
        }
        Ok(())
    }

    /// Upload file using rapid upload (for files < 4MB or known files)
    /// and chunked upload for larger files.
    ///
    /// Returns the cloud server_mtime captured after a successful write,
    /// or None if the API didn't return one (e.g. rapid upload).
    async fn upload_file_internal(&self, relative_path: &str, content: &[u8]) -> Result<Option<i64>> {
        let token = self.ensure_token().await?;
        let remote_path = self.remote_path(relative_path);

        // Ensure parent directory exists
        if let Some(parent) = Path::new(&remote_path).parent() {
            let parent_str = parent.to_string_lossy().to_string();
            let _ = self.ensure_remote_dir(&parent_str).await;
        }

        let md5_bytes = md5::compute(content);
        let content_md5 = md5_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();
        let size = content.len() as u64;

        // Step 1: Pre-create
        let isdir_s = "0".to_string();
        let autoinit_s = "1".to_string();
        // rtype=3 means "overwrite the same-name file on the cloud" (只维持最新版).
        // Without it, Baidu would auto-rename and keep multiple versions.
        let rtype_s = "3".to_string();
        let block_list_s = format!("[\"{}\"]", content_md5);
        let precreate_resp = self.client.post(format!("{}/file?method=precreate", BAIDU_FILE_API))
            .form(&[
                ("access_token", &token.access_token),
                ("path", &remote_path),
                ("size", &size.to_string()),
                ("isdir", &isdir_s),
                ("autoinit", &autoinit_s),
                ("rtype", &rtype_s),  // 3 = overwrite existing file (keep only latest version)
                ("content-md5", &content_md5),
                ("block_list", &block_list_s),
            ])
            .send().await
            .context("Failed to pre-create file")?;

        let precreate_body = precreate_resp.text().await
            .context("Failed to read precreate response")?;
        let precreate: BaiduPreCreateResponse = serde_json::from_str(&precreate_body)
            .context(format!("Failed to parse precreate response"))?;

        if let Some(errno) = precreate.errno {
            if errno != 0 {
                anyhow::bail!("Pre-create failed (errno {}): {}", errno, precreate_body);
            }
        }

        // If rapid upload succeeded (return_type=1), we're done.
        // Rapid upload doesn't return server_mtime → return None (caller falls back to now()).
        if precreate.return_type == 1 {
            info!("Baidu rapid upload success: {}", relative_path);
            return Ok(None);
        }

        // Step 2: Upload file content
        let uploadid = &precreate.uploadid;
        use reqwest::multipart;
        let part = multipart::Part::bytes(content.to_vec())
            .file_name(relative_path.to_string())
            .mime_str("application/octet-stream")?;

        let form = multipart::Form::new()
            .part("file", part);

        let partseq = "0".to_string();
        let file_type = "tmpfile".to_string();
        let upload_resp = self.client.post(format!("{}/file?method=upload", BAIDU_API_BASE))
            .query(&[
                ("access_token", &token.access_token),
                ("path", &remote_path),
                ("uploadid", uploadid),
                ("partseq", &partseq),
                ("type", &file_type),
            ])
            .multipart(form)
            .send().await
            .context("Failed to upload file")?;

        let upload_body = upload_resp.text().await
            .context("Failed to read upload response")?;
        let upload: BaiduUploadResponse = serde_json::from_str(&upload_body)
            .context("Failed to parse upload response")?;

        if let Some(errno) = upload.errno {
            if errno != 0 {
                anyhow::bail!("Upload failed (errno {}): {}", errno, upload_body);
            }
        }

        // Step 3: Create file (combine uploaded blocks, overwrite with rtype=3)
        let block_list = format!("[\"{}\"]", upload.md5);
        let isdir_c = "0".to_string();
        let rtype_c = "3".to_string();
        let create_resp = self.client.post(format!("{}/file?method=create", BAIDU_FILE_API))
            .form(&[
                ("access_token", &token.access_token),
                ("path", &remote_path),
                ("size", &size.to_string()),
                ("isdir", &isdir_c),
                ("rtype", &rtype_c),
                ("uploadid", uploadid),
                ("block_list", &block_list),
            ])
            .send().await
            .context("Failed to create file on Baidu Pan")?;

        let create_body = create_resp.text().await
            .context("Failed to read create response")?;
        let create: BaiduCreateResponse = serde_json::from_str(&create_body)
            .context("Failed to parse create response")?;

        if let Some(errno) = create.errno {
            if errno != 0 {
                anyhow::bail!("File create failed (errno {}): {}", errno, create_body);
            }
        }

        info!("Baidu upload success: {} ({} bytes)", relative_path, size);
        // Return the exact cloud server_mtime as the new sync baseline
        Ok(create.mtime)
    }

    /// Download file by remote path
    async fn download_file_internal(&self, remote_path: &str) -> Result<Vec<u8>> {
        let token = self.ensure_token().await?;

        let path_owned = remote_path.to_string();
        let resp = self.client.get(format!("{}/file?method=download", BAIDU_API_BASE))
            .query(&[
                ("access_token", &token.access_token),
                ("path", &path_owned),
            ])
            .send().await
            .context("Failed to download file from Baidu Pan")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Download failed ({}): {}", status, body);
        }

        let bytes = resp.bytes().await
            .context("Failed to read download content")?;

        Ok(bytes.to_vec())
    }

    /// Delete file on Baidu Pan
    async fn delete_file_internal(&self, remote_path: &str) -> Result<()> {
        let token = self.ensure_token().await?;

        let filelist = format!("[\"{}\"]", remote_path);
        let resp = self.client.post(format!("{}/file?method=filemanager", BAIDU_FILE_API))
            .query(&[("access_token", &token.access_token)])
            .form(&[
                ("opera", "delete"),
                ("filelist", &filelist),
            ])
            .send().await
            .context("Failed to delete file on Baidu Pan")?;

        let body = resp.text().await.unwrap_or_default();
        if !body.contains("\"errno\":0") {
            warn!("Delete response: {}", body);
            // errno 12 means file not found - treat as success
            if !body.contains("\"errno\":12") && !body.contains("\"errno\":-9") {
                anyhow::bail!("Delete failed: {}", body);
            }
        }

        info!("Baidu delete success: {}", remote_path);
        Ok(())
    }
}

// ──────────────────────────────────────────────
// SyncAdapter Implementation
// ──────────────────────────────────────────────

#[async_trait::async_trait]
impl SyncAdapter for BaiduAdapter {
    async fn list_remote_files(&self) -> Result<Vec<FileMeta>> {
        // Ensure app root directory exists
        let _ = self.ensure_remote_dir(REMOTE_ROOT).await;

        let raw_files = self.list_dir_recursive(REMOTE_ROOT).await?;

        let mut files = Vec::new();
        for f in raw_files {
            let relative = match self.relative_path(&f.path) {
                Some(r) => r,
                None => continue,
            };

            // Filter: only .md and attachments/*
            if !relative.ends_with(".md") && !relative.starts_with("attachments/") {
                continue;
            }

            let modified: DateTime<Utc> = DateTime::from_timestamp(f.server_mtime, 0)
                .unwrap_or_else(|| Utc::now());

            files.push(FileMeta {
                relative_path: relative,
                // Baidu doesn't provide SHA-256; use MD5 as the hash fallback.
                // The mtime-first comparison in the engine is authoritative; this
                // hash is only consulted when no baseline exists yet.
                sha256: f.md5,
                size: f.size,
                modified,
                last_synced: None,
            });
        }

        Ok(files)
    }

    async fn download_file(&self, relative_path: &str) -> Result<Vec<u8>> {
        let remote = self.remote_path(relative_path);
        self.download_file_internal(&remote).await
    }

    async fn upload_file(&self, relative_path: &str, content: &[u8]) -> Result<Option<i64>> {
        self.upload_file_internal(relative_path, content).await
    }

    async fn delete_remote_file(&self, relative_path: &str) -> Result<()> {
        let remote = self.remote_path(relative_path);
        self.delete_file_internal(&remote).await
    }

    async fn is_connected(&self) -> bool {
        // Check if we have a valid token
        if let Some(token) = &self.token {
            if token.is_expired() {
                return false;
            }
            // Try to get user info
            return self.get_user_info().await.is_ok();
        }
        false
    }

    fn adapter_name(&self) -> &str {
        "Baidu Pan"
    }
}

// ──────────────────────────────────────────────
// md5 crate (lightweight, for Baidu API content-md5)
// ──────────────────────────────────────────────

mod md5 {
    pub struct Md5 {
        state: [u32; 4],
        count: u64,
        buffer: [u8; 64],
    }

    impl Md5 {
        pub fn new() -> Self {
            Md5 {
                state: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476],
                count: 0,
                buffer: [0; 64],
            }
        }

        pub fn update(&mut self, data: &[u8]) {
            let mut offset = (self.count % 64) as usize;
            self.count += data.len() as u64;

            for &byte in data {
                self.buffer[offset] = byte;
                offset += 1;
                if offset == 64 {
                    let block: [u8; 64] = self.buffer;
                    self.process_block(&block);
                    offset = 0;
                }
            }
        }

        pub fn finalize(mut self) -> [u8; 16] {
            let bit_len = self.count * 8;
            let offset = (self.count % 64) as usize;

            // Padding
            self.buffer[offset] = 0x80;
            for i in (offset + 1)..64 {
                self.buffer[i] = 0;
            }

            if offset >= 56 {
                let block: [u8; 64] = self.buffer;
                self.process_block(&block);
                self.buffer = [0; 64];
            }

            self.buffer[56..64].copy_from_slice(&bit_len.to_le_bytes());
            let block: [u8; 64] = self.buffer;
            self.process_block(&block);

            let mut result = [0u8; 16];
            for (i, &word) in self.state.iter().enumerate() {
                result[i * 4..(i + 1) * 4].copy_from_slice(&word.to_le_bytes());
            }
            result
        }

        fn process_block(&mut self, block: &[u8; 64]) {
            const K: [u32; 64] = [
                0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
                0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
                0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
                0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
                0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
                0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
                0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
                0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
                0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
                0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
                0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
                0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
                0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
                0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
                0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
                0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
            ];

            const S: [u32; 64] = [
                7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
            ];

            let mut m = [0u32; 16];
            for i in 0..16 {
                m[i] = u32::from_le_bytes([
                    block[i * 4], block[i * 4 + 1],
                    block[i * 4 + 2], block[i * 4 + 3],
                ]);
            }

            let [mut a, mut b, mut c, mut d] = self.state;

            for i in 0..64 {
                let (f, g) = if i < 16 {
                    ((b & c) | (!b & d), i)
                } else if i < 32 {
                    ((d & b) | (!d & c), (5 * i + 1) % 16)
                } else if i < 48 {
                    (b ^ c ^ d, (3 * i + 5) % 16)
                } else {
                    (c ^ (b | !d), (7 * i) % 16)
                };

                let temp = d;
                d = c;
                c = b;
                b = b.wrapping_add(
                    (a.wrapping_add(f).wrapping_add(K[i]).wrapping_add(m[g]))
                        .rotate_left(S[i])
                );
                a = temp;
            }

            self.state[0] = self.state[0].wrapping_add(a);
            self.state[1] = self.state[1].wrapping_add(b);
            self.state[2] = self.state[2].wrapping_add(c);
            self.state[3] = self.state[3].wrapping_add(d);
        }
    }

    pub fn compute(data: &[u8]) -> [u8; 16] {
        let mut hasher = Md5::new();
        hasher.update(data);
        hasher.finalize()
    }
}
