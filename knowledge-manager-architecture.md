## 个人知识管理系统（MiniObsidian）— 系统架构设计文档

> 版本：1.1 | 日期：2026-06-22 | 技术栈：Tauri 2.x + Rust + React

---

## 一、设计哲学与核心原则

本系统遵循三个核心设计原则：**本地优先**（Local-First）、**同步可靠**（Sync-Reliable）、**AI 可选**（AI-Optional）。

本地优先意味着所有笔记数据以文件形式存储在用户本地磁盘，离线状态下编辑、搜索、浏览功能完全可用，不依赖任何远程服务。同步可靠是指百度网盘同步作为最高优先级模块，需做到增量传输、冲突自动解决、断点续传，确保多设备间数据一致。AI 可选则表示大模型能力作为增强层存在，用户可自主选择是否启用、使用哪个模型、以及哪些笔记允许发送到云端处理。

---

## 二、技术选型总览

| 层次 | 选型 | 决策理由 |
|------|------|----------|
| 桌面框架 | Tauri 2.x | 包体积仅约 10MB（Electron 约 150MB），内存占用低，Rust 后端性能好且安全 |
| 前端 UI | React 18 + TailwindCSS 3.4 | 生态成熟，组件丰富；CSS 变量颜色系统驱动主题切换 |
| Markdown 渲染 | MDX + remark/rehype 插件链 | 支持 GFM、数学公式、Mermaid 图表等扩展语法 |
| 编辑器 | CodeMirror 6 | 高性能、可扩展，支持语法高亮和主题适配 |
| 本地数据库 | SQLite（via rusqlite） | 轻量嵌入式数据库，用于笔记元数据和搜索索引 |
| 文件监听 | notify（Rust crate） | 跨平台文件系统事件监听，实时感知笔记变更 |
| 云同步 | 百度网盘 Open API v3 | 用户指定需求，国内覆盖好，免费空间大 |
| AI 接口 | 统一 Adapter 模式 | 支持 OpenAI、文心一言、通义千问、Ollama 本地模型等切换 |
| 全文搜索 | Tantivy（Rust 搜索引擎） | 纯 Rust 实现，性能优异，支持中文分词 |

---

## 三、系统整体架构

系统分为四层，自上而下为：表示层（前端 UI）、业务逻辑层（Rust 核心服务）、数据持久层（文件系统 + SQLite）、外部集成层（百度网盘 + AI 服务）。

```
┌─────────────────────────────────────────────────────────┐
│                    表示层 (React + Tauri WebView)         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 笔记编辑器 │  │ 文件浏览器 │  │ 搜索面板  │  │ AI 面板 │ │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └────┬────┘ │
│        │             │             │             │       │
│  ──────┴─────────────┴─────────────┴─────────────┴───── │
│              Tauri IPC Bridge (invoke)                   │
├─────────────────────────────────────────────────────────┤
│                  业务逻辑层 (Rust Core)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ NoteService   │  │ SyncEngine   │  │ AIAnalyzer    │  │
│  │ 笔记CRUD      │  │ 同步引擎      │  │ AI分析引擎    │  │
│  │ 标签/文件夹    │  │ 文件监听      │  │ 多模型适配器  │  │
│  │ 双向链接      │  │ 增量传输      │  │ 摘要/关键词   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
├─────────┴────────────────┴──────────────────┴──────────┤
│                   数据持久层                              │
│  ┌────────────────┐  ┌───────────────────────────────┐  │
│  │ 文件系统        │  │ SQLite                        │  │
│  │ ~/MyNotes/      │  │ 元数据表、搜索索引、同步状态表  │  │
│  │  ├── inbox/     │  │                               │  │
│  │  ├── projects/  │  │ notes_meta (id, path, hash,   │  │
│  │  ├── references/│  │   title, tags, created_at,    │  │
│  │  └── .vault/    │  │   updated_at, sync_status)    │  │
│  └────────────────┘  └───────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│                  外部集成层                               │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │ 百度网盘 Open API     │  │ AI Model Adapters        │  │
│  │  OAuth 2.0 认证      │  │  OpenAI / 文心 / 通义     │  │
│  │  增量上传/下载        │  │  Ollama (本地)           │  │
│  │  冲突检测与解决       │  │  自定义 Adapter 扩展     │  │
│  └─────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 四、笔记管理核心模块（NoteService）

### 4.1 本地文件结构设计

笔记以 `.md` 文件形式存储在用户指定的 Vault 目录中，采用"文件夹 + 文件"的直观组织方式。系统额外维护一个 `.vault/` 隐藏目录存放配置和缓存数据。

```
~/MyNotes/                          # 用户指定的 Vault 根目录
├── inbox/                          # 默认收件箱，新笔记先落这里
│   └── 2026-06-15-meeting.md
├── projects/                       # 用户自定义文件夹
│   ├── project-alpha/
│   └── reading-list.md
├── daily/                          # 日记/日志
│   └── 2026-06-15.md
├── templates/                      # 笔记模板
│   └── meeting-note.md
├── attachments/                    # 附件（图片、PDF 等）
│   └── diagram-001.png
└── .vault/                         # 系统隐藏目录（不纳入同步）
    ├── config.toml                 # 用户配置
    ├── trash/                      # 软删除回收站
    ├── cache/                      # 搜索索引缓存
    └── sync-state.db               # 同步状态数据库
```

### 4.2 笔记元数据与 Frontmatter

每篇笔记支持 YAML Frontmatter，用于声明结构化元数据。系统会自动解析并同步到 SQLite 中，供搜索和过滤使用。

```yaml
---
title: 项目周会记录
tags: [meeting, project-alpha]
created: 2026-06-15T10:00:00+08:00
updated: 2026-06-15T11:30:00+08:00
links: [project-alpha-readme, sprint-plan]
ai_summary: "本次会议讨论了 Alpha 项目的里程碑进度..."
---

## 会议内容

...正文...
```

### 4.3 双向链接与知识图谱

采用 `[[笔记名]]` 语法实现双向链接（兼容 Obsidian 格式），Rust 后端在保存笔记时自动扫描链接关系并写入 SQLite 的 `links` 表。前端可基于这些数据渲染知识图谱视图。

```sql
CREATE TABLE links (
    source_id TEXT NOT NULL,   -- 源笔记 ID
    target_id TEXT NOT NULL,   -- 目标笔记 ID
    context  TEXT,             -- 链接所在段落上下文
    PRIMARY KEY (source_id, target_id),
    FOREIGN KEY (source_id) REFERENCES notes_meta(id),
    FOREIGN KEY (target_id) REFERENCES notes_meta(id)
);
```

### 4.4 全文搜索

使用 Tantivy 搜索引擎构建全文索引，集成 jieba-rs 进行中文分词。索引字段包括标题、正文、标签和路径。搜索响应时间目标：5000 篇笔记内 < 50ms。

```rust
// Tantivy 索引 Schema 设计
let mut schema_builder = Schema::builder();
schema_builder.add_text_field("id", STRING | STORED);
schema_builder.add_text_field("title", TEXT | STORED);
schema_builder.add_text_field("body", TEXT);
schema_builder.add_text_field("tags", TEXT);
schema_builder.add_text_field("path", STRING | STORED);
schema_builder.add_date_field("updated_at", INDEXED | STORED);
```

### 4.5 关键技术决策

**为何选择文件系统 + SQLite 而非纯数据库存储？** 文件系统保留了笔记的"可移植性"——用户可以用任何编辑器打开、复制、移动笔记文件，不存在格式锁定。SQLite 仅作为元数据的"索引层"，即使 SQLite 损坏，重建索引也只需扫描全部文件即可。

**为何选择 CodeMirror 6 而非 Monaco？** CodeMirror 6 的包体积约为 Monaco 的 1/5，且其模块化架构更适合在 Tauri WebView 中嵌入。对于 Markdown 编辑场景，CodeMirror 的实时预览和语法高亮能力已经足够出色。

---

## 五、百度网盘同步模块（SyncEngine）— 核心重点

这是整个系统最复杂也最关键的模块，设计方案会格外详细。

### 5.1 同步架构概览

同步引擎采用"监听-比较-传输"三阶段模型，核心目标是：最小化网络流量、正确处理冲突、保证数据不丢失。

```
                    本地文件系统
                         │
                    ┌────┴────┐
                    │ Watcher │  ← notify 文件监听
                    └────┬────┘
                         │ 变更事件
                    ┌────┴────────┐
                    │ ChangeQueue │  ← 变更队列（内存 + 持久化）
                    └────┬────────┘
                         │ 取出变更批次
                    ┌────┴──────────┐
                    │ DiffEngine    │  ← 与 sync-state 对比
                    │ (差异计算)     │     决定：上传/下载/冲突
                    └────┬──────────┘
                         │ 同步指令
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌──────────┐
         │ Upload │ │ Download│ │ Conflict │
         │ Batch  │ │ Batch  │ │ Resolver │
         └───┬────┘ └───┬────┘ └────┬─────┘
             └──────────┼───────────┘
                        │
                   ┌────┴────┐
                   │ BaiduAPI│  ← 百度网盘 Open API
                   │ Client  │
                   └─────────┘
```

### 5.2 文件变更追踪

Rust 后端通过 `notify` crate 监听 Vault 目录的文件系统事件。为了避免频繁触发同步，采用"防抖聚合"策略：收集 2 秒内的所有变更事件，合并为一批次处理。

```rust
#[derive(Debug, Clone)]
struct FileChange {
    path: PathBuf,
    change_type: ChangeType,  // Created, Modified, Deleted, Renamed
    timestamp: i64,
    content_hash: String,     // SHA-256 摘要
}

enum ChangeType {
    Created,
    Modified,
    Deleted,
    Renamed { from: PathBuf },
}
```

每个文件的变更状态会持久化到 `sync-state.db` 中，即使应用意外崩溃重启，也能从上次状态恢复同步。

```sql
CREATE TABLE sync_state (
    file_path     TEXT PRIMARY KEY,
    local_hash    TEXT NOT NULL,       -- 本地文件 SHA-256
    remote_hash   TEXT,                -- 云端文件 SHA-256
    sync_status   TEXT NOT NULL,       -- synced, pending_upload, pending_download, conflict
    last_synced   INTEGER NOT NULL,    -- 上次同步时间戳
    remote_fid    TEXT,                -- 百度网盘文件 ID
    version       INTEGER DEFAULT 1    -- 版本号（用于冲突检测）
);

CREATE INDEX idx_sync_status ON sync_state(sync_status);
```

### 5.3 增量同步策略

同步的核心原则是**只传输有变化的部分**。具体策略如下：

**文件级增量**：通过比较本地文件的 SHA-256 哈希与 sync_state 中记录的 remote_hash，仅上传/下载内容发生变化的文件。对于新增文件直接上传，远端新增文件直接下载。

**分片上传**：对于大于 4MB 的文件，调用百度网盘的分片上传接口（`/superfile2`），每片 4MB，支持并发上传和断点续传。

**批量请求**：将多个小文件的元数据查询合并为单次百度 API 调用（`/list` 接口支持批量查询），减少 HTTP 请求次数。

**同步调度**：

| 触发条件 | 行为 | 延迟 |
|---------|------|------|
| 文件编辑保存 | 上传该文件 | 即时（2s 防抖后） |
| 应用启动 | 全量比对元数据，增量同步差异 | 立即执行 |
| 定时轮询 | 检查远端是否有其他设备的变更 | 每 5 分钟 |
| 网络恢复 | 处理积压的变更队列 | 立即执行 |
| 用户手动触发 | 强制全量同步 | 立即执行 |

### 5.4 冲突解决策略

冲突是同步系统中最棘手的问题。本系统采用"三路合并 + 版本保留"策略。

**冲突判定条件**：当本地文件和远端文件在同一时间窗口内都被修改（即 local_hash 和 remote_hash 都与 last_synced 时记录的 base_hash 不同），则判定为冲突。

**解决流程**：

```
检测到冲突
    │
    ├── 1. 备份当前本地版本到 .vault/conflicts/ 目录
    │      文件名格式: {原文件名}.conflict.{时间戳}.md
    │
    ├── 2. 尝试自动合并（基于 diff3 算法）
    │      ├── 合并成功 → 应用合并结果，标记为 synced
    │      └── 合并失败（同一区域冲突）→ 进入手动解决
    │
    └── 3. 手动解决模式
           ├── 在编辑器中并排显示本地版本和远端版本
           ├── 用户选择保留哪一版，或手动编辑合并
           └── 确认后上传最终版本，清理冲突标记
```

**兜底保障**：无论冲突解决结果如何，所有历史版本都保留在 `.vault/conflicts/` 中至少 30 天，确保数据零丢失。

### 5.5 百度网盘 API 集成要点

**认证流程**：采用 OAuth 2.0 授权码模式。用户在设置页面点击"连接百度网盘"后，弹出浏览器窗口完成授权，应用获取 access_token 和 refresh_token。Token 使用 Rust 的 `keyring` crate 存储在系统密钥链中（Windows: Credential Manager，macOS: Keychain）。

```rust
struct BaiduAuth {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

impl BaiduAuth {
    async fn ensure_valid(&mut self) -> Result<()> {
        if self.expires_at - Utc::now().timestamp() < 300 {
            // 提前 5 分钟刷新
            self.refresh().await?;
        }
        Ok(())
    }

    async fn refresh(&mut self) -> Result<()> {
        // 调用百度 OAuth refresh_token 接口
        let resp = client.post("https://openapi.baidu.com/oauth/2.0/token")
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", &self.refresh_token),
                ("client_id", &config.client_id),
                ("client_secret", &config.client_secret),
            ])
            .send().await?;
        // 更新 token
        Ok(())
    }
}
```

**API 限流应对**：百度网盘对 API 调用频率有限制（约 10 次/秒）。同步引擎内置令牌桶限流器，并设计了指数退避重试策略：

```rust
struct RateLimiter {
    tokens: Arc<Mutex<f64>>,
    max_tokens: f64,        // 桶容量: 10
    refill_rate: f64,       // 每秒补充: 8（留有余量）
}

// 重试策略：1s → 2s → 4s → 8s → 最大 30s，最多重试 5 次
async fn with_retry<F, T>(f: F, max_retries: u32) -> Result<T>
where F: Fn() -> Future<Output = Result<T>> {
    for attempt in 0..max_retries {
        match f().await {
            Ok(val) => return Ok(val),
            Err(e) if e.is_rate_limited() => {
                let delay = Duration::from_secs(2u64.pow(attempt).min(30));
                tokio::time::sleep(delay).await;
            }
            Err(e) => return Err(e),
        }
    }
    Err(anyhow!("Max retries exceeded"))
}
```

**远端目录映射**：百度网盘上的文件目录结构镜像本地 Vault 结构，根路径为用户网盘下的 `/apps/MiniObsidian/`（百度应用专属目录）。

### 5.6 离线与网络不稳定处理

同步引擎维护一个持久化的 `pending_operations` 队列。当网络不可用时，所有上传/下载操作进入该队列；网络恢复后，队列中的操作按时间顺序依次执行。

```sql
CREATE TABLE pending_operations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path   TEXT NOT NULL,
    operation   TEXT NOT NULL,      -- upload, download, delete
    priority    INTEGER DEFAULT 0,  -- 0=普通, 1=高优先
    created_at  INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0,
    content_hash TEXT               -- 用于校验
);
```

### 5.7 关键技术决策

**为何不用现有同步库（如 Automerge）？** 百度网盘 API 是文件级别的存储接口，不是通用的分布式数据库。Automerge 等 CRDT 方案适用于对等网络同步，与百度网盘这种"中心化文件存储"模型不匹配。自建同步引擎虽然工作量大，但能精确适配百度 API 的特性。

**为何冲突备份保留 30 天？** 知识管理场景中，用户可能在数天甚至数周后才发现某次同步覆盖了重要内容。30 天是一个在"数据安全"和"存储空间"之间的平衡点，用户也可以自行调整这个期限。

---

## 六、AI 多模型理解模块（AIAnalyzer）

### 6.1 统一适配器架构

AI 模块采用"适配器模式"（Adapter Pattern），定义统一接口，每种模型服务实现各自的适配器。用户可在设置中切换模型，也可以为不同功能指定不同模型（比如摘要用 GPT，关键词提取用本地模型）。

```rust
#[async_trait]
trait AIModelAdapter: Send + Sync {
    /// 模型标识
    fn name(&self) -> &str;

    /// 检查模型是否可用（网络、API Key 等）
    async fn health_check(&self) -> Result<bool>;

    /// 生成笔记摘要
    async fn summarize(&self, content: &str, opts: SummaryOpts) -> Result<String>;

    /// 提取关键词和标签
    async fn extract_keywords(&self, content: &str) -> Result<Vec<Keyword>>;

    /// 语义问答（基于笔记内容）
    async fn ask(&self, question: &str, context: &[NoteChunk]) -> Result<String>;

    /// 生成笔记标题建议
    async fn suggest_title(&self, content: &str) -> Result<Vec<String>>;
}

struct SummaryOpts {
    max_length: usize,      // 摘要最大字数
    style: SummaryStyle,    // 段落式 / 要点式
    language: String,       // 输出语言
}

struct Keyword {
    term: String,
    weight: f32,            // 权重 0.0 ~ 1.0
    category: Option<String>,
}
```

### 6.2 已规划的适配器实现

**OpenAI Adapter**：调用 GPT-4o / GPT-4o-mini 的 Chat Completion 接口。适合需要高质量语义理解的场景。

**文心一言 Adapter**：调用百度 ERNIE-4.0 接口。国内访问稳定，中文理解能力强。

**通义千问 Adapter**：调用阿里云 Qwen-Max 接口。中文场景性价比高。

**Ollama Adapter**：通过本地 Ollama REST API（默认 `http://localhost:11434`）调用本地模型（如 Llama 3、Qwen2 等）。完全离线运行，隐私性最好，但理解能力取决于本地硬件和模型大小。

```rust
struct OllamaAdapter {
    base_url: String,       // 默认 http://localhost:11434
    model: String,          // 如 "qwen2:7b"
    timeout: Duration,
}

#[async_trait]
impl AIModelAdapter for OllamaAdapter {
    async fn summarize(&self, content: &str, opts: SummaryOpts) -> Result<String> {
        let prompt = format!(
            "请为以下笔记内容生成一段{}字的摘要，使用{}风格：\n\n{}",
            opts.max_length,
            match opts.style { SummaryStyle::Paragraph => "段落", SummaryStyle::Bullet => "要点列表" },
            content
        );
        let resp = reqwest::Client::new()
            .post(format!("{}/api/generate", self.base_url))
            .json(&json!({
                "model": self.model,
                "prompt": prompt,
                "stream": false
            }))
            .timeout(self.timeout)
            .send().await?;
        // 解析响应...
        Ok(result)
    }
    // ... 其他方法
}
```

### 6.3 笔记内容预处理

在发送给模型之前，需要对笔记进行预处理：

**分块（Chunking）**：对于长笔记（超过模型上下文窗口的 60%），按段落边界切分为多个 chunk，每个 chunk 约 1000-2000 字，保留前后 chunk 的重叠（约 200 字）以维持上下文连贯性。

**Frontmatter 剥离**：摘要和关键词提取时保留 Frontmatter 作为上下文；语义问答时可选择性地只传入正文。

**敏感内容过滤**：用户可配置"隐私规则"，匹配特定模式的笔记（如包含 `#private` 标签的笔记）不发送到云端模型，仅使用本地模型处理。

```rust
struct NoteChunk {
    note_id: String,
    note_title: String,
    content: String,
    chunk_index: usize,
    total_chunks: usize,
}

fn chunk_note(note: &Note, max_chunk_size: usize, overlap: usize) -> Vec<NoteChunk> {
    // 按段落边界分块，保持 overlap 重叠
    let paragraphs = note.content.split("\n\n").collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut current_chunk = String::new();

    for para in paragraphs {
        if current_chunk.len() + para.len() > max_chunk_size && !current_chunk.is_empty() {
            chunks.push(current_chunk.clone());
            // 保留重叠
            let overlap_text = get_last_n_chars(&current_chunk, overlap);
            current_chunk = overlap_text + "\n\n" + para;
        } else {
            if !current_chunk.is_empty() {
                current_chunk.push_str("\n\n");
            }
            current_chunk.push_str(para);
        }
    }
    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }
    // 转为 NoteChunk ...
    chunks.into_iter().enumerate().map(|(i, c)| NoteChunk {
        note_id: note.id.clone(),
        note_title: note.title.clone(),
        content: c,
        chunk_index: i,
        total_chunks: 0, // 稍后填充
    }).collect()
}
```

### 6.4 AI 结果的存储与利用

AI 生成的摘要和关键词写回笔记的 Frontmatter 中，同时存入 SQLite 的 `ai_metadata` 表，供搜索和推荐系统使用。

```sql
CREATE TABLE ai_metadata (
    note_id      TEXT PRIMARY KEY,
    model_used   TEXT NOT NULL,        -- 使用的模型名称
    summary      TEXT,
    keywords     TEXT,                 -- JSON 数组
    embedding    BLOB,                 -- 向量嵌入（预留，用于语义搜索）
    generated_at INTEGER NOT NULL,
    content_hash TEXT NOT NULL         -- 生成时的笔记哈希，用于判断是否需要重新生成
);
```

当笔记被编辑后，系统比较当前 content_hash 与 ai_metadata 中记录的 content_hash，如果不同，自动标记该笔记的 AI 数据为"过期"，在空闲时重新生成。

### 6.5 隐私保护机制

**分级授权**：用户在设置中为每个文件夹或标签设定 AI 访问权限——"允许云端处理"、"仅本地模型"或"不处理"。

**传输加密**：所有与云端 AI 服务的通信均使用 HTTPS，请求头中不携带用户标识信息。

**最小化原则**：发送请求时只包含当前操作所需的最小文本内容，不附带笔记的完整历史或其他关联笔记。

**审计日志**：系统记录每次 AI 调用的日志（模型名称、笔记 ID、时间），用户可在设置中查看"AI 使用记录"。

### 6.6 关键技术决策

**为何采用适配器模式而非直接调用各 API？** 适配器模式将"模型选择"与"业务逻辑"彻底解耦。新增一个模型支持只需实现 `AIModelAdapter` trait，无需修改上层调用代码。这也为未来社区开发第三方适配器插件留下接口。

**为何 AI 结果存入 Frontmatter 而非独立存储？** 写入 Frontmatter 后，即使用户将笔记迁移到其他工具（如直接导入 Obsidian），AI 摘要和关键词仍然跟随笔记，增强了数据可移植性。

---

## 七、主题系统（Theme System）

### 7.1 架构概览

主题系统采用 **CSS 变量 + Tailwind 语义化颜色** 的双层架构，实现全应用颜色的统一管理和即时切换。

```
┌─────────────────────────────────────────────────────────┐
│  用户操作：设置面板切换主题                                 │
│  SettingsPanel.updateSetting('theme', 'light')           │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  applyTheme('light')                                     │
│  document.documentElement.style.setProperty('--bg-base',  │
│    '#eff1f5')                                            │
│  document.documentElement.classList.add('light-theme')    │
└───────────────────────┬─────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
┌─────────────────────┐  ┌──────────────────────────────┐
│ Tailwind 语义类      │  │ CSS 直接引用变量              │
│ bg-base → var(--bg-base) │  │ body { background: var(--bg-base) } │
│ text-text-primary    │  │ .markdown-preview h1 { color: var(--accent) } │
│ border-border-muted  │  │ .wiki-link { color: var(--accent) } │
└─────────────────────┘  └──────────────────────────────┘
            │                       │
            └───────────┬───────────┘
                        ▼
            所有组件颜色即时切换，无页面刷新
```

### 7.2 CSS 变量定义

系统定义了 28 个语义化 CSS 变量，分为四类：

| 类别 | 变量 | 深色值（Mocha） | 浅色值（Latte） |
|------|------|----------------|----------------|
| 背景 | `--bg-base` | `#1e1e2e` | `#eff1f5` |
| 背景 | `--bg-surface` | `#181825` | `#e6e9ef` |
| 背景 | `--bg-overlay` | `#11111b` | `#dce0e8` |
| 背景 | `--bg-muted` | `#313244` | `#ccd0da` |
| 背景 | `--bg-hover` | `#45475a` | `#bcc0cc` |
| 背景 | `--bg-subtle` | `#585b70` | `#9ca0b0` |
| 强调 | `--accent` | `#cba6f7` | `#8839ef` |
| 强调 | `--red` | `#f38ba8` | `#d20f39` |
| 强调 | `--blue` | `#89b4fa` | `#1e66f5` |
| 强调 | `--green` | `#a6e3a1` | `#40a02b` |
| 强调 | `--yellow` | `#f9e2af` | `#df8e1d` |
| 文本 | `--text-primary` | `#cdd6f4` | `#4c4f69` |
| 文本 | `--text-secondary` | `#a6adc8` | `#6c6f85` |
| 文本 | `--text-muted` | `#6c7086` | `#8c8fa1` |
| 边框 | `--border-muted` | `#313244` | `#ccd0da` |
| 边框 | `--border-hover` | `#45475a` | `#bcc0cc` |

### 7.3 Tailwind 语义化颜色映射

`tailwind.config.js` 将 CSS 变量映射为 Tailwind 工具类，组件中使用语义化类名而非硬编码颜色值：

```javascript
// tailwind.config.js
theme: {
  extend: {
    colors: {
      base:          'var(--bg-base)',
      surface:       'var(--bg-surface)',
      accent:        'var(--accent)',
      'text-primary':   'var(--text-primary)',
      'text-secondary': 'var(--text-secondary)',
      'border-muted':   'var(--border-muted)',
      // ... 共 28 个映射
    },
  },
},
```

组件中使用方式：

```tsx
// 正确 — 使用语义化类名，自动跟随主题
<div className="bg-base text-text-primary border border-border-muted">

// 错误 — 硬编码颜色，不响应主题切换
<div className="bg-[#1e1e2e] text-[#cdd6f4] border border-[#313244]">
```

### 7.4 状态管理与持久化

主题设置通过 `SettingsPanel` 组件管理，使用 `localStorage` 持久化：

```typescript
interface AppSettings {
  theme: 'dark' | 'light'
  uiFontSize: number
  editorFontSize: number
  language: 'zh' | 'en'
}

// 应用启动时加载并应用
const settings = loadSettings()  // 从 localStorage 读取
applyTheme(settings.theme)       // 设置 CSS 变量 + class
applyFontSizes(settings.uiFontSize, settings.editorFontSize)
```

### 7.5 CodeMirror 编辑器主题适配

CodeMirror 编辑器通过 JS `EditorView.theme()` 定义深色主题（硬编码颜色），亮色主题通过 CSS 覆盖规则实现：

```css
/* 深色主题由 JS 注入（catppuccinTheme），亮色通过 CSS 覆盖 */
.light-theme .cm-editor { color: var(--text-primary) !important; }
.light-theme .cm-editor .cm-gutters { background: var(--bg-surface) !important; }
.light-theme .cm-editor .tok-heading { color: var(--accent) !important; }
/* ... 完整覆盖选择区、行号、语法高亮等 */
```

### 7.6 非 Tailwind 元素的主题适配

以下元素不通过 Tailwind 类名着色，需在 `index.css` 中直接使用 CSS 变量：

- `body` 背景和文字颜色
- 滚动条（`::-webkit-scrollbar-thumb`）
- Markdown 预览区域（`.markdown-preview h1/h2/code/blockquote/...`）
- AI 面板 Markdown 内容（`.ai-markdown-content`）
- Wiki 链接（`.wiki-link`）
- 文件夹树动画（`.folder-item`）

这些元素在 `index.css` 中统一使用 `var(--xxx)` 引用，当 `applyTheme()` 更新变量值时自动切换。

### 7.7 关键技术决策

**为何选择 CSS 变量而非 Tailwind `dark:` 前缀？** Tailwind 的 `dark:` 前缀依赖 `prefers-color-scheme` 媒体查询或 class 切换，但无法处理 CodeMirror JS 主题和非 Tailwind 元素。CSS 变量方案统一了所有着色来源——Tailwind 类、CSS 规则、JS 主题都通过同一组变量驱动。

**为何不将 CodeMirror 主题也改为 CSS 变量？** CodeMirror 的 `EditorView.theme()` 在创建时生成静态 CSS 规则。虽然支持 `var()` 语法，但亮色主题的覆盖（如选区透明度、语法高亮颜色）需要更精细的控制，通过 `.light-theme` CSS 覆盖更灵活可靠。

**为何 esbuild CSS 压缩器会导致转义选择器失败？** 之前的方案使用 `.bg-\[#1e1e2e\] { background-color: var(--bg-base) !important; }` 重定向 Tailwind 任意值类。但 esbuild 在压缩 CSS 时会破坏反斜杠转义，导致选择器失效。迁移到 Tailwind 语义化颜色后，完全消除了对转义选择器的依赖。

---

## 八、数据流总览

以下是一篇笔记从创建到同步再到 AI 处理的完整数据流：

```
用户输入内容
    │
    ▼
CodeMirror 编辑器 ──→ Tauri IPC ──→ NoteService.save()
                                        │
                          ┌─────────────┼────────────────┐
                          ▼             ▼                ▼
                     写入 .md 文件   更新 SQLite       触发 SyncEngine
                                     (元数据/索引)
                                        │
                                    ┌───┴───┐
                                    ▼       ▼
                              更新索引   更新链接图谱
                              (Tantivy)  (links 表)
                                        │
                              SyncEngine 收到通知
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                     计算 SHA-256   检查网络状态   入 ChangeQueue
                                        │
                                   网络可用？
                                   │       │
                                  Yes      No → 入 pending_operations
                                   │
                              检查 sync_state
                                   │
                           ┌───────┼───────┐
                           ▼       ▼       ▼
                        新文件   已修改   已删除
                           │       │       │
                           ▼       ▼       ▼
                        上传     上传     标记远端删除
                                        │
                                   更新 sync_state
                                        │
                              ┌─────────┴──────────┐
                              ▼                    ▼
                         同步完成              AI 空闲触发
                                                   │
                                          ┌────────┼────────┐
                                          ▼        ▼        ▼
                                       摘要     关键词    嵌入向量
                                       生成     提取     (预留)
                                          │
                                     写回 Frontmatter
                                     更新 ai_metadata
```

---

## 九、项目模块结构（Rust workspace）

```
mini-obsidian/
├── Cargo.toml                  # workspace 根配置
├── src-tauri/                  # Tauri 应用入口
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/           # Tauri IPC 命令注册
│   │   │   ├── notes.rs
│   │   │   ├── sync.rs
│   │   │   └── ai.rs
│   │   └── setup.rs
│   └── tauri.conf.json
├── crates/
│   ├── note-core/              # 笔记管理核心库
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── parser.rs       # Markdown + Frontmatter 解析
│   │   │   ├── link.rs         # 双向链接处理
│   │   │   └── search.rs       # Tantivy 搜索集成
│   │   └── Cargo.toml
│   ├── sync-engine/            # 同步引擎
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── watcher.rs      # 文件监听
│   │   │   ├── diff.rs         # 差异计算
│   │   │   ├── conflict.rs     # 冲突解决
│   │   │   ├── queue.rs        # 变更队列
│   │   │   └── transport.rs    # 传输调度
│   │   └── Cargo.toml
│   ├── baidu-netdisk/          # 百度网盘 API 客户端
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── auth.rs         # OAuth 认证
│   │   │   ├── files.rs        # 文件操作 API
│   │   │   └── rate_limit.rs   # 限流器
│   │   └── Cargo.toml
│   ├── ai-analyzer/            # AI 分析引擎
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── adapter.rs      # 适配器 trait 定义
│   │   │   ├── openai.rs       # OpenAI 适配器
│   │   │   ├── wenxin.rs       # 文心一言适配器
│   │   │   ├── qwen.rs         # 通义千问适配器
│   │   │   ├── ollama.rs       # Ollama 本地适配器
│   │   │   ├── chunker.rs      # 内容分块
│   │   │   └── privacy.rs      # 隐私过滤
│   │   └── Cargo.toml
│   └── storage/                # 数据持久化层
│       ├── src/
│       │   ├── lib.rs
│       │   ├── schema.rs       # SQLite 表结构定义
│       │   └── migrations.rs   # 数据库迁移
│       └── Cargo.toml
├── src-web/                    # React 前端
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Editor/         # Markdown 编辑器（CodeMirror 6）
│   │   │   ├── Sidebar/        # 文件浏览器
│   │   │   ├── TabBar/         # 多标签页栏
│   │   │   ├── Settings/       # 设置面板（主题/字体/语言）
│   │   │   ├── Search/         # 搜索面板
│   │   │   ├── Graph/          # 知识图谱视图
│   │   │   ├── AI/             # AI 面板（摘要、问答）
│   │   │   ├── Sync/           # 云同步面板
│   │   │   ├── PDF/            # PDF 导出
│   │   │   └── Backlinks/      # 反向链接面板
│   │   ├── styles/
│   │   │   └── index.css       # 全局样式（CSS 变量默认值、markdown 预览、CodeMirror 覆盖）
│   │   ├── __tests__/
│   │   │   ├── setup.ts        # 测试环境配置
│   │   │   └── theme.test.ts   # 主题系统单元/集成测试
│   │   ├── hooks/              # 自定义 React Hooks
│   │   └── ipc/                # Tauri IPC 封装层
│   └── vite.config.ts
└── docs/                       # 项目文档
    └── architecture.md
```

---

## 十、分阶段实施建议

### Phase 1：核心笔记体验（约 4-6 周）

本阶段聚焦打造流畅的本地笔记编辑和管理体验，不依赖任何外部服务。

核心交付物包括：Tauri 应用框架搭建、CodeMirror 编辑器集成（支持实时预览和 Frontmatter 解析）、文件夹式笔记组织、本地全文搜索（Tantivy + 中文分词）、双向链接解析与知识图谱基础视图、笔记的创建/编辑/删除/重命名/移动，以及应用配置的持久化存储。

### Phase 2：百度网盘同步（约 4-6 周）

本阶段是项目的技术难点，需要大量测试和边界情况处理。

核心交付物包括：百度网盘 OAuth 授权流程、文件级增量同步（上传/下载）、冲突检测与自动/手动解决、离线操作队列与网络恢复后同步、同步状态可视化 UI（同步中/已同步/冲突标记），以及 Token 安全存储和自动刷新。

### Phase 3：AI 智能理解（约 3-4 周）

本阶段为系统增加智能化能力。

核心交付物包括：统一 AI 适配器框架、至少两个云端适配器（如 OpenAI + 文心一言）和 Ollama 本地适配器、笔记自动摘要和关键词提取、基于笔记内容的语义问答面板、隐私分级配置 UI，以及 AI 结果的 Frontmatter 回写和过期自动刷新。

### Phase 4：增强与打磨（部分已实现）

**主题系统（已完成）**：CSS 变量 + Tailwind 语义化颜色双层架构，支持 Catppuccin Mocha/Latte 亮暗色切换，28 个语义化颜色变量，CodeMirror 编辑器主题适配，设置持久化，12 个单元/集成测试。

**PDF 导出（已完成）**：PDFCanvas 组件支持笔记导出为 PDF。

剩余规划：笔记模板系统、标签管理与过滤、快捷键系统优化、以及性能优化和 Bug 修复。

---

## 十一、扩展性预留

系统在多个关键位置预留了扩展点：

**同步源扩展**：SyncEngine 的 transport 层使用 trait 抽象，未来可以新增 WebDAV、OneDrive、iCloud 等同步源适配器，无需修改上层同步逻辑。

**AI 模型扩展**：AIModelAdapter trait 是唯一的接入契约，社区可以开发更多模型的适配器（如 Claude、Gemini、本地 vLLM 等）。

**插件接口预留**：Tauri 2.x 支持插件机制，未来可以将 AI 适配器和新功能封装为插件，用户按需安装。

**格式扩展**：当前以 Markdown 为核心，但 parser 层设计为可扩展，未来可支持 Org-mode、AsciiDoc 等格式的导入。

---

## 附录：核心依赖清单

| Crate / 库 | 版本 | 用途 |
|-------------|------|------|
| tauri | 2.x | 桌面应用框架 |
| rusqlite | 0.31 | SQLite 数据库操作 |
| tantivy | 0.22 | 全文搜索引擎 |
| jieba-rs | 0.7 | 中文分词 |
| notify | 6.x | 文件系统事件监听 |
| serde / serde_yaml | 1.x | 序列化，YAML Frontmatter 解析 |
| reqwest | 0.12 | HTTP 客户端（API 调用） |
| tokio | 1.x | 异步运行时 |
| sha2 | 0.10 | SHA-256 哈希计算 |
| keyring | 3.x | 系统密钥链存储 |
| pulldown-cmark | 0.11 | Markdown 解析 |
| diffy | 0.4 | diff3 合并算法 |

前端方面：React 18、TailwindCSS 3.4（CSS 变量颜色系统）、CodeMirror 6、@tauri-apps/api、reactflow（知识图谱）、katex（数学公式）、highlight.js（代码高亮）、Vitest 1.x + happy-dom（测试）。
