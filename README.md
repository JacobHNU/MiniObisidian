# MiniObsidian

本地优先的个人知识管理系统，基于 Tauri 2.x + Rust + React 构建。

> 完整架构设计文档见 [knowledge-manager-architecture.md](./knowledge-manager-architecture.md)

## 设计哲学

本系统遵循三个核心设计原则：

- **本地优先（Local-First）**：所有笔记数据以文件形式存储在用户本地磁盘，离线状态下编辑、搜索、浏览功能完全可用，不依赖任何远程服务
- **同步可靠（Sync-Reliable）**：云同步模块做到增量传输、冲突自动解决、断点续传，确保多设备间数据一致
- **AI 可选（AI-Optional）**：大模型能力作为增强层存在，用户可自主选择是否启用、使用哪个模型、以及哪些笔记允许发送到云端处理

## 系统架构

系统分为四层：

```
┌─────────────────────────────────────────────────────────┐
│  表示层 (React 18 + TailwindCSS)                         │
│  编辑器 · 文件浏览器 · 搜索面板 · AI 面板 · 知识图谱       │
│              Tauri IPC Bridge (invoke)                   │
├─────────────────────────────────────────────────────────┤
│  业务逻辑层 (Rust Core)                                   │
│  NoteService · SyncEngine · AIAnalyzer                   │
├─────────────────────────────────────────────────────────┤
│  数据持久层                                               │
│  文件系统 (.md 文件) · SQLite (元数据/索引/同步状态)        │
├─────────────────────────────────────────────────────────┤
│  外部集成层                                               │
│  百度网盘 Open API · AI Model Adapters (OpenAI/文心/Ollama)│
└─────────────────────────────────────────────────────────┘
```

## 当前已实现功能

### Phase 1：核心笔记体验（已实现）

- **笔记管理**：创建、编辑、删除、重命名、移动笔记，支持文件夹组织
- **多标签页**：同时打开多个笔记，标签栏切换，独立内容管理，自动保存
- **双向链接**：使用 `[[wiki-link]]` 语法建立笔记间关联，兼容 Obsidian 格式
- **知识图谱**：力导向布局可视化笔记链接关系，支持拖拽、缩放、高亮关联节点
- **Markdown 编辑**：支持实时预览、分屏编辑、GFM 语法、图片粘贴
- **日记功能**：一键创建/打开今日日记，按 `daily/YYYY/MM/YYYY-MM-DD.md` 自动归档
- **搜索**：按标题、标签、路径快速检索笔记
- **附件管理**：支持图片粘贴自动保存到 `attachments/` 目录
- **Frontmatter**：每篇笔记包含 YAML 元数据（ID、标题、标签、创建/更新时间、链接）

### Phase 2：百度网盘同步（规划中）

- 百度网盘 OAuth 2.0 授权流程
- 文件级增量同步（上传/下载），基于 SHA-256 哈希比对
- 分片上传（>4MB 文件），支持断点续传
- 冲突检测与自动/手动解决（diff3 合并算法）
- 离线操作队列，网络恢复后自动同步
- API 限流与指数退避重试

### Phase 3：AI 智能理解（已实现）

- **AI 问答面板**：三栏式布局（侧边栏 | 笔记编辑 | AI 面板），支持展开/收起、拖拽拉伸
- **OpenAI 兼容接口**：支持 OpenAI、文心一言、通义千问、Ollama 等所有兼容 API
- **多笔记上下文注入**：自动识别所有打开的标签页，支持手动选择注入哪些笔记
- **上下文预处理**：自动去除 Frontmatter、规范化空白字符、智能截断适配 token 限制
- **Token 预算控制**：按 2.5 字符/token 估算，可配置最大上下文 token 数，超限自动截断
- **Markdown 渲染回复**：AI 回复支持完整 Markdown 格式（标题、列表、代码块、表格、引用）
- **对话管理**：支持 Copy 复制回复、Retry 重新生成、Clear 清空对话
- **配置持久化**：API Key、API URL、模型名称、token 限制保存在 localStorage

### Phase 4：增强与打磨（规划中）

- 笔记模板系统
- 标签管理与过滤
- 快捷键系统优化
- 导出功能（PDF/HTML）

## 技术栈

| 层次 | 选型 | 决策理由 |
|------|------|----------|
| 桌面框架 | Tauri 2.x | 包体积约 10MB（Electron 约 150MB），内存占用低，Rust 后端安全 |
| 前端 UI | React 18 + TailwindCSS | 生态成熟，组件丰富 |
| Markdown 渲染 | ReactMarkdown + remark/rehype | 支持 GFM、Frontmatter，AI 回复渲染复用 |
| 编辑器 | 原生 textarea（规划升级 CodeMirror 6） | 当前轻量实现，后续升级支持语法高亮、Vim 模式 |
| 本地数据库 | SQLite (rusqlite) | 轻量嵌入式，用于笔记元数据和链接索引 |
| 双向链接 | pulldown-cmark + 自定义解析 | 兼容 Obsidian `[[wiki-link]]` 格式 |
| 知识图谱 | 力导向布局 + SVG | 纯前端实现，无额外依赖 |
| AI 接口 | reqwest + OpenAI 兼容 API | Rust 异步 HTTP，支持所有兼容接口 |

## 项目结构

```
mini-obsidian/
├── src-tauri/                  # Tauri 应用入口
│   ├── src/main.rs             # 应用启动、窗口配置
│   ├── src/commands.rs         # IPC 命令（笔记 CRUD、图谱、附件、AI 聊天）
│   ├── tauri.conf.json         # Tauri 配置（窗口、权限）
│   └── capabilities/           # 权限声明
├── crates/
│   ├── note-core/              # 笔记核心库
│   │   ├── src/service.rs      # NoteService（笔记 CRUD、扫描、图谱）
│   │   ├── src/parser.rs       # YAML Frontmatter 解析与序列化
│   │   └── src/link.rs         # 双向链接提取（[[wiki-link]]）
│   └── storage/                # 数据持久层
│       ├── src/lib.rs          # SQLite 数据库操作封装
│       └── src/schema.rs       # 表结构定义与迁移
├── src-web/                    # React 前端
│   ├── src/App.tsx             # 主应用（多标签页状态管理、自动保存）
│   ├── src/components/
│   │   ├── Editor/EditorPanel.tsx    # Markdown 编辑/预览/分屏
│   │   ├── Sidebar/Sidebar.tsx       # 文件浏览器（树形结构、右键菜单）
│   │   ├── TabBar/TabBar.tsx         # 多标签页栏
│   │   ├── AI/AIPanel.tsx            # AI 问答面板（多笔记上下文、Markdown 渲染）
│   │   ├── Search/SearchPanel.tsx    # 搜索面板
│   │   ├── Graph/GraphView.tsx       # 知识图谱（力导向 SVG）
│   │   └── VaultSetup.tsx            # 首次启动 Vault 选择
│   ├── src/hooks/useNotes.ts         # 笔记状态管理 Hook
│   └── src/ipc/tauri.ts              # Tauri IPC 封装（含 AI 聊天）
├── Cargo.toml                  # Rust workspace 配置
├── package.json                # Node.js 依赖
├── knowledge-manager-architecture.md  # 完整架构设计文档
└── mini-obsidian-architecture.drawio  # 架构图
```

## 快速开始

### 环境要求

- [Rust](https://rustup.rs/) (>= 1.88.0)
- [Node.js](https://nodejs.org/) (>= 18)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Windows，需勾选"使用 C++ 的桌面开发")
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows 10/11 通常已预装)

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npx tauri dev
```

启动 Vite 开发服务器（热更新）+ Tauri 窗口，修改前端代码会实时刷新。

### 构建发布版

```bash
npx tauri build
```

构建完成后，可执行文件位于 `target/release/mini-obsidian.exe`。可直接复制到任意 Windows 机器运行（需 WebView2 Runtime）。

## 使用说明

1. **首次启动**：选择一个文件夹作为笔记库（Vault）
2. **创建笔记**：点击侧边栏的 "+" 按钮，或在指定文件夹中右键创建
3. **多标签页**：点击侧边栏笔记自动打开为标签页，支持同时打开多个，标签栏可关闭
4. **双向链接**：在笔记中输入 `[[笔记名]]` 建立关联
5. **知识图谱**：点击工具栏的图谱按钮查看笔记关系网络
6. **AI 问答**：点击工具栏 "AI" 按钮打开 AI 面板，首次使用需配置 API Key
7. **AI 上下文选择**：展开 Context 面板，勾选需要注入的笔记，系统自动控制 token 预算
8. **日记**：点击日历图标创建/打开今日日记
9. **搜索**：点击搜索按钮，按标题、标签或路径检索
10. **图片粘贴**：在编辑器中直接粘贴剪贴板图片，自动保存到 attachments/
11. **切换 Vault**：点击侧边栏底部按钮切换笔记库

## 数据存储

笔记以 `.md` 文件形式存储在用户指定的 Vault 目录中：

```
MyNotes/                        # 用户选择的 Vault 根目录
├── inbox/                      # 收件箱（新笔记默认位置）
├── daily/                      # 日记（按年月归档）
│   └── 2026/06/
│       └── 2026-06-16.md
├── attachments/                # 附件（图片等）
│   └── paste-1718500000.png
└── .vault/                     # 系统隐藏目录
    ├── data.db                 # SQLite 元数据库
    └── trash/                  # 已删除笔记回收站
```

每篇笔记包含 YAML Frontmatter：

```yaml
---
id: "550e8400-e29b-41d4-a716-446655440000"
title: "会议记录"
tags: ["meeting", "project"]
created: "2026-06-16T10:00:00+08:00"
updated: "2026-06-16T11:30:00+08:00"
links: ["project-alpha", "sprint-plan"]
---
```

## License

MIT
