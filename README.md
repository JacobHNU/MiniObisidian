# MiniObsidian

本地优先的个人知识管理系统，基于 Tauri 2.x + Rust + React 构建。

## 特性

- **笔记管理**：创建、编辑、删除、重命名、移动笔记，支持文件夹组织
- **双向链接**：使用 `[[wiki-link]]` 语法建立笔记间关联，兼容 Obsidian 格式
- **知识图谱**：可视化展示笔记间的链接关系，支持拖拽和缩放
- **Markdown 编辑**：支持实时预览、分屏编辑、GFM 语法、图片粘贴
- **日记功能**：一键创建/打开今日日记，按年月自动归档
- **全文搜索**：按标题、标签、路径快速检索笔记
- **附件管理**：支持图片粘贴自动保存到附件目录
- **本地存储**：所有数据以 .md 文件存储在本地，无格式锁定

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.x |
| 前端 UI | React 18 + TailwindCSS |
| Markdown 渲染 | ReactMarkdown + remark/rehype |
| 后端 | Rust (note-core, storage crates) |
| 数据库 | SQLite (rusqlite) |
| 文件解析 | YAML Frontmatter + SHA-256 哈希 |

## 项目结构

```
mini-obsidian/
├── src-tauri/                  # Tauri 应用入口
│   ├── src/main.rs             # 应用启动、窗口配置
│   ├── src/commands.rs         # IPC 命令（笔记 CRUD、图谱、附件等）
│   ├── tauri.conf.json         # Tauri 配置（窗口、权限）
│   └── capabilities/           # 权限声明
├── crates/
│   ├── note-core/              # 笔记核心库
│   │   ├── src/service.rs      # NoteService（笔记操作）
│   │   ├── src/parser.rs       # Frontmatter 解析
│   │   └── src/link.rs         # 双向链接提取
│   └── storage/                # 数据持久层
│       ├── src/lib.rs          # SQLite 数据库操作
│       └── src/schema.rs       # 表结构定义
├── src-web/                    # React 前端
│   ├── src/App.tsx             # 主应用组件
│   ├── src/components/         # UI 组件（Editor, Sidebar, Search, Graph）
│   ├── src/hooks/              # React Hooks
│   └── src/ipc/tauri.ts        # Tauri IPC 封装
├── icons/                      # 应用图标
├── Cargo.toml                  # Rust workspace 配置
├── package.json                # Node.js 依赖
└── vite.config.ts              # Vite 构建配置
```

## 快速开始

### 环境要求

- [Rust](https://rustup.rs/) (>= 1.88.0)
- [Node.js](https://nodejs.org/) (>= 18)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Windows，需勾选"使用 C++ 的桌面开发")
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows 10/11 通常已预装)

### 安装依赖

```bash
# 前端依赖
npm install

# Rust 依赖会在首次构建时自动下载
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

构建完成后，可执行文件位于：
- `target/release/mini-obsidian.exe`（Windows）
- 项目根目录的 `MiniObsidian.exe`（手动复制）

## 使用说明

1. **首次启动**：选择一个文件夹作为笔记库（Vault）
2. **创建笔记**：点击侧边栏的 "+" 按钮，或在指定文件夹中创建
3. **双向链接**：在笔记中输入 `[[笔记名]]` 建立关联
4. **知识图谱**：点击工具栏的图谱按钮查看笔记关系网络
5. **日记**：点击日历图标创建/打开今日日记
6. **搜索**：点击搜索按钮，按标题、标签或路径检索
7. **图片粘贴**：在编辑器中直接粘贴剪贴板图片，自动保存到 attachments/

## 数据存储

笔记以 `.md` 文件形式存储在用户指定的 Vault 目录中：

```
MyNotes/
├── inbox/          # 收件箱（新笔记默认位置）
├── daily/          # 日记（按年月归档）
│   └── 2026/06/
├── attachments/    # 附件（图片等）
└── .vault/         # 系统目录（数据库、回收站）
    ├── data.db     # SQLite 元数据
    └── trash/      # 已删除笔记
```

每篇笔记包含 YAML Frontmatter，记录 ID、标题、标签、创建/更新时间等元数据。

## License

MIT
