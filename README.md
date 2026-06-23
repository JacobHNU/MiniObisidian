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

### Phase 2：云同步（已实现）

- **同步引擎架构**：SyncEngine + SyncAdapter 抽象层，支持扩展多种云端后端
- **增量同步**：基于 SHA-256 哈希比对的变更检测，仅传输变化文件
- **冲突解决**：支持 KeepNewer / KeepLocal / KeepRemote / KeepBoth 四种策略，冲突文件自动备份
- **本地文件夹适配器**：同步到本地云盘目录（如百度网盘本地同步文件夹），作为云端适配器参考实现
- **变更预览**：同步前可扫描并预览待变更文件列表（Added / Modified / Deleted）
- **同步 UI**：独立同步面板，显示上传/下载/删除/冲突统计，支持一键同步

### Phase 3：AI 智能理解（已实现）

- **AI 问答面板**：三栏式布局（侧边栏 | 笔记编辑 | AI 面板），支持展开/收起、拖拽拉伸
- **OpenAI 兼容接口**：支持 OpenAI、文心一言、通义千问、Ollama 等所有兼容 API
- **多笔记上下文注入**：自动识别所有打开的标签页，支持手动选择注入哪些笔记
- **上下文预处理**：自动去除 Frontmatter、规范化空白字符、智能截断适配 token 限制
- **Token 预算控制**：按 2.5 字符/token 估算，可配置最大上下文 token 数，超限自动截断
- **Markdown 渲染回复**：AI 回复支持完整 Markdown 格式（标题、列表、代码块、表格、引用）
- **对话管理**：支持 Copy 复制回复、Retry 重新生成、Clear 清空对话
- **配置持久化**：API Key、API URL、模型名称、token 限制保存在 localStorage

### 主题系统（已实现）

- **CSS 变量驱动**：通过 28 个语义化 CSS 变量（`--bg-base`、`--text-primary`、`--accent` 等）统一控制全应用颜色
- **Tailwind 语义化颜色**：`tailwind.config.js` 将 CSS 变量映射为 Tailwind 类名（`bg-base`、`text-text-primary`、`border-border-muted` 等），组件中不使用硬编码颜色值
- **亮色/暗色主题**：内置 Catppuccin Mocha（深色）和 Latte（浅色）两套完整配色，一键切换
- **即时切换**：`applyTheme()` 通过 `document.documentElement.style.setProperty()` 批量更新 CSS 变量，无页面刷新、无样式闪烁
- **CodeMirror 适配**：编辑器通过 `.light-theme` CSS 覆盖规则适配亮色主题，语法高亮、选择区、行号等全部跟随主题
- **设置持久化**：主题、语言、字体大小等设置保存在 `localStorage`，重启后自动恢复
- **测试覆盖**：12 个单元/集成测试验证 settings 持久化、applyTheme、字体大小、完整切换流程

### Phase 4：增强与打磨（规划中）

- 笔记模板系统
- 标签管理与过滤
- 快捷键系统优化
- 导出功能（PDF/HTML）

## 技术栈

| 层次 | 选型 | 决策理由 |
|------|------|----------|
| 桌面框架 | Tauri 2.x | 包体积约 10MB（Electron 约 150MB），内存占用低，Rust 后端安全 |
| 前端 UI | React 18 + TailwindCSS 3.4 | 生态成熟，组件丰富；CSS 变量颜色系统驱动主题切换 |
| Markdown 渲染 | ReactMarkdown + remark/rehype | 支持 GFM、Frontmatter，AI 回复渲染复用 |
| 编辑器 | CodeMirror 6 | 高性能可扩展 Markdown 编辑器，支持语法高亮和主题适配 |
| 本地数据库 | SQLite (rusqlite) | 轻量嵌入式，用于笔记元数据和链接索引 |
| 双向链接 | pulldown-cmark + 自定义解析 | 兼容 Obsidian `[[wiki-link]]` 格式 |
| 知识图谱 | 力导向布局 + SVG | 纯前端实现，无额外依赖 |
| AI 接口 | reqwest + OpenAI 兼容 API | Rust 异步 HTTP，支持所有兼容接口 |

## 项目结构

```
mini-obsidian/
├── src-tauri/                  # Tauri 应用入口
│   ├── src/main.rs             # 应用启动、窗口配置
│   ├── src/commands.rs         # IPC 命令（笔记 CRUD、图谱、附件、AI 聊天、云同步）
│   ├── tauri.conf.json         # Tauri 配置（窗口、权限）
│   └── capabilities/           # 权限声明
├── crates/
│   ├── note-core/              # 笔记核心库
│   │   ├── src/service.rs      # NoteService（笔记 CRUD、扫描、图谱）
│   │   ├── src/parser.rs       # YAML Frontmatter 解析与序列化
│   │   └── src/link.rs         # 双向链接提取（[[wiki-link]]）
│   ├── storage/                # 数据持久层
│   │   ├── src/lib.rs          # SQLite 数据库操作封装
│   │   └── src/schema.rs       # 表结构定义与迁移
│   └── sync-engine/            # 同步引擎
│       ├── src/lib.rs          # SyncEngine、ChangeDetector、ConflictResolver
│       └── src/local_adapter.rs # 本地文件夹同步适配器
├── src-web/                    # React 前端
│   ├── src/App.tsx             # 主应用（多标签页状态管理、自动保存、主题初始化）
│   ├── src/components/
│   │   ├── Editor/EditorPanel.tsx    # Markdown 编辑/预览/分屏
│   │   ├── Editor/CodeMirrorEditor.tsx # CodeMirror 6 编辑器（主题适配）
│   │   ├── Sidebar/Sidebar.tsx       # 文件浏览器（树形结构、右键菜单）
│   │   ├── TabBar/TabBar.tsx         # 多标签页栏
│   │   ├── Settings/SettingsPanel.tsx # 设置面板（主题/字体/语言，applyTheme 核心）
│   │   ├── AI/AIPanel.tsx            # AI 问答面板（多笔记上下文、Markdown 渲染）
│   │   ├── Sync/SyncPanel.tsx        # 云同步面板（变更预览、一键同步）
│   │   ├── Search/SearchPanel.tsx    # 搜索面板
│   │   ├── Graph/GraphView.tsx       # 知识图谱（力导向 SVG）
│   │   ├── PDF/PDFCanvas.tsx         # PDF 导出预览
│   │   ├── Backlinks/BacklinksPanel.tsx # 反向链接面板
│   │   └── VaultSetup.tsx            # 首次启动 Vault 选择
│   ├── src/styles/index.css          # 全局样式（CSS 变量默认值、markdown 预览、CodeMirror 覆盖）
│   ├── src/__tests__/theme.test.ts   # 主题系统单元/集成测试
│   ├── src/hooks/useNotes.ts         # 笔记状态管理 Hook
│   └── src/ipc/tauri.ts              # Tauri IPC 封装（含 AI 聊天、云同步）
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

### 运行测试

```bash
npm test              # 运行一次
npm run test:watch    # 监听模式
```

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
11. **云同步**：点击工具栏 "Sync" 按钮，配置同步目录后可扫描变更并一键同步
12. **切换 Vault**：点击侧边栏底部按钮切换笔记库
13. **主题切换**：打开设置面板（齿轮图标），在"外观"标签下切换亮色/暗色主题，即时生效
14. **字体大小**：设置面板中可独立调整 UI 字体大小和编辑器字体大小

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
