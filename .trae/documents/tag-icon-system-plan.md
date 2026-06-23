# 标签系统 + 图标系统开发方案

> 版本：1.0 | 日期：2026-06-23

## 一、概述

在现有 MiniObsidian 系统基础上，新增两个核心功能模块：

1. **标签（Tag）系统**：为笔记和文件夹创建、编辑、删除标签，支持跨笔记本关联、按标签搜索/筛选、标签管理面板
2. **图标系统**：为笔记本（文件夹）、标签提供自定义图标标识，使用 lucide-react 内置图标库 + Emoji

两个系统通过侧边栏底部 Tab 切换（文件/标签）入口访问。

## 二、现状分析

### 已有基础
- `notes_meta` 表已有 `tags TEXT DEFAULT '[]'` 列（JSON 数组）
- `Frontmatter` 已有 `tags: Vec<String>` 字段，序列化/反序列化完整
- `create_note` IPC 已接受 `tags: Option<Vec<String>>` 参数
- `Sidebar` 过滤逻辑已支持按 `n.tags` 搜索
- `lucide-react` 已安装为项目依赖
- `config` 键值表可用于存储文件夹元数据

### 缺失部分
- 没有独立的标签元数据表（颜色、图标、描述）
- 没有标签展示/编辑 UI
- 没有按标签筛选笔记的专用界面
- 没有图标管理系统（当前全部硬编码 SVG）
- 没有文件夹自定义图标功能

## 三、技术方案

### 3.1 数据库层变更

#### 新增 `tags` 表（`crates/storage/src/schema.rs`）

```sql
CREATE TABLE IF NOT EXISTS tags (
    name        TEXT PRIMARY KEY,           -- 标签名（唯一标识）
    color       TEXT NOT NULL DEFAULT '#cba6f7', -- 标签颜色（hex）
    icon        TEXT,                       -- 图标标识（lucide 名称或 emoji 字符）
    description TEXT NOT NULL DEFAULT '',   -- 标签描述
    created_at  TEXT NOT NULL
);
```

#### 新增 `folder_meta` 表

```sql
CREATE TABLE IF NOT EXISTS folder_meta (
    path        TEXT PRIMARY KEY,           -- 文件夹相对路径
    icon        TEXT,                       -- 图标标识（lucide 名称或 emoji 字符）
    color       TEXT                        -- 文件夹颜色（可选）
);
```

#### 新增 `note_icons` 存储

在 `config` 表中以 `icon:{note_id}` 为 key 存储笔记图标标识。

### 3.2 Rust 后端变更

#### `crates/storage/src/schema.rs`
- 新增 `Tag` 结构体：`name, color, icon, description, created_at`
- 新增 `FolderMeta` 结构体：`path, icon, color`
- 新增 `CREATE_TABLES` 中的建表语句

#### `crates/storage/src/lib.rs`
新增 Database 方法：
- `create_tag(tag: &Tag) -> Result<()>`
- `update_tag(name: &str, color: Option<&str>, icon: Option<&str>, description: Option<&str>) -> Result<()>`
- `delete_tag(name: &str) -> Result<()>`
- `list_tags() -> Result<Vec<Tag>>`
- `get_tag(name: &str) -> Result<Option<Tag>>`
- `set_folder_icon(path: &str, icon: Option<&str>) -> Result<()>`
- `get_folder_meta(path: &str) -> Result<Option<FolderMeta>>`
- `list_folder_metas() -> Result<Vec<FolderMeta>>`
- `set_note_icon(note_id: &str, icon: Option<&str>) -> Result<()>`
- `get_note_icon(note_id: &str) -> Result<Option<String>>`
- `get_notes_by_tag(tag_name: &str) -> Result<Vec<NoteMeta>>`（查询 `notes_meta.tags` JSON 中包含指定标签的笔记）

#### `src-tauri/src/commands.rs`
新增 IPC 命令：
- `create_tag(name, color, icon, description) -> Tag`
- `update_tag(name, color, icon, description) -> Tag`
- `delete_tag(name) -> ()`
- `list_tags() -> Vec<Tag>`
- `get_notes_by_tag(tag_name) -> Vec<NoteMeta>`
- `set_folder_icon(path, icon) -> ()`
- `get_folder_icon(path) -> Option<String>`
- `list_folder_icons() -> Vec<FolderMeta>`
- `set_note_icon(note_id, icon) -> ()`
- `get_note_icon(note_id) -> Option<String>`
- `add_tag_to_note(note_id, tag_name) -> NoteMeta`
- `remove_tag_from_note(note_id, tag_name) -> NoteMeta`

#### `src-tauri/src/main.rs`
- 在 `invoke_handler` 中注册所有新命令

### 3.3 前端 IPC 层变更

#### `src-web/src/ipc/tauri.ts`
新增类型和函数：
```typescript
interface Tag {
  name: string
  color: string
  icon: string | null
  description: string
  created_at: string
}

interface FolderMeta {
  path: string
  icon: string | null
  color: string | null
}

// 新增 IPC 函数
export async function createTag(name, color, icon?, description?): Promise<Tag>
export async function updateTag(name, color?, icon?, description?): Promise<Tag>
export async function deleteTag(name): Promise<void>
export async function listTags(): Promise<Tag[]>
export async function getNotesByTag(tagName): Promise<NoteMeta[]>
export async function setFolderIcon(path, icon): Promise<void>
export async function getFolderIcon(path): Promise<string | null>
export async function listFolderIcons(): Promise<FolderMeta[]>
export async function setNoteIcon(noteId, icon): Promise<void>
export async function getNoteIcon(noteId): Promise<string | null>
export async function addTagToNote(noteId, tagName): Promise<NoteMeta>
export async function removeTagFromNote(noteId, tagName): Promise<NoteMeta>
```

### 3.4 前端组件变更

#### 3.4.1 新建 `src-web/src/components/Tags/TagPanel.tsx`

侧边栏标签面板，替代文件树视图：
- **标签列表**：展示所有标签，每个标签显示图标 + 名称 + 颜色圆点 + 笔记数量
- **点击标签**：在侧边栏下方展开该标签关联的笔记列表，点击笔记跳转
- **新建标签**：顶部输入框 + 颜色选择器 + 图标选择器
- **编辑标签**：右键菜单（编辑颜色/图标/描述、删除）
- **拖拽关联**：支持从文件树拖拽笔记到标签上建立关联

#### 3.4.2 新建 `src-web/src/components/Tags/TagInput.tsx`

笔记标签输入组件，嵌入编辑器工具栏或笔记属性区：
- 输入框支持自动补全（从已有标签列表中选择）
- 已选标签以彩色标签胶囊形式展示，点击 × 移除
- 回车创建新标签或选择已有标签

#### 3.4.3 新建 `src-web/src/components/Tags/TagBadge.tsx`

标签胶囊展示组件：
- 显示标签图标（lucide 或 emoji）+ 标签名
- 背景色使用标签自定义颜色（低透明度）
- 支持 `onClick`、`onRemove` 回调

#### 3.4.4 新建 `src-web/src/components/Icons/IconPicker.tsx`

图标选择器弹窗：
- **搜索框**：过滤图标名称
- **Emoji 区域**：常用 emoji 网格（文件夹📁、星星⭐、火焰🔥等分类）
- **Lucide 图标区域**：按类别分组展示 lucide-react 图标
- **最近使用**：展示最近选择的图标
- 返回图标标识字符串（lucide 名称如 `"FolderOpen"` 或 emoji 如 `"📁"`）

#### 3.4.5 新建 `src-web/src/components/Icons/IconRenderer.tsx`

统一图标渲染组件：
```tsx
function IconRenderer({ icon, size?, className? }: { icon: string | null; size?: number; className?: string })
```
- 如果 `icon` 是 lucide 名称 → 从 lucide-react 动态渲染
- 如果 `icon` 是 emoji 字符 → 直接渲染为文本
- 如果 `icon` 为 null → 渲染默认图标

#### 3.4.6 修改 `src-web/src/components/Sidebar/Sidebar.tsx`

- 底部新增「文件/标签」Tab 切换按钮
- 添加 `sidebarView: 'files' | 'tags'` 状态
- `sidebarView === 'files'` 时显示现有文件树
- `sidebarView === 'tags'` 时显示 `<TagPanel />`
- 文件夹节点使用 `<IconRenderer>` 渲染自定义图标
- 笔记节点旁显示标签胶囊（最多 3 个，超出显示 +N）

#### 3.4.7 修改 `src-web/src/components/Editor/EditorPanel.tsx`

- 在编辑器顶部工具栏区域添加 `<TagInput>` 组件
- 标签变更时同步更新笔记的 frontmatter tags 字段

#### 3.4.8 修改 `src-web/src/App.tsx`

- 新增 `sidebarView` 状态传递给 Sidebar
- 标签筛选结果可直接在编辑区打开

### 3.5 i18n 变更

#### `src-web/src/i18n/locales/en.ts` 和 `zh.ts`
新增翻译键：
```
sidebar.files / sidebar.tags
tags.panel / tags.newTag / tags.tagName / tags.tagColor / tags.tagIcon
tags.editTag / tags.deleteTag / tags.deleteTagConfirm
tags.noTags / tags.notesCount / tags.addTag / tags.removeTag
tags.searchTags / tags.allTags / tags.filterByTag
icons.picker / icons.search / icons.emoji / icons.lucide / icons.recent
```

### 3.6 测试计划

#### 单元测试
- `tags.test.ts`：标签 CRUD、标签关联/移除、按标签查询
- `iconRenderer.test.tsx`：lucide 图标渲染、emoji 渲染、null 默认值

#### 集成测试
- 创建标签 → 为笔记添加标签 → 按标签搜索 → 验证结果
- 设置文件夹图标 → 重新加载 → 验证图标持久化
- 标签面板 → 点击标签 → 验证笔记列表展示

## 四、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `crates/storage/src/schema.rs` | 新增 Tag、FolderMeta 结构体和建表语句 |
| 修改 | `crates/storage/src/lib.rs` | 新增 tag/icon CRUD 方法 |
| 修改 | `src-tauri/src/commands.rs` | 新增 12 个 IPC 命令 |
| 修改 | `src-tauri/src/main.rs` | 注册新命令 |
| 修改 | `src-web/src/ipc/tauri.ts` | 新增类型和 IPC 函数 |
| 新建 | `src-web/src/components/Tags/TagPanel.tsx` | 标签管理面板 |
| 新建 | `src-web/src/components/Tags/TagInput.tsx` | 标签输入组件 |
| 新建 | `src-web/src/components/Tags/TagBadge.tsx` | 标签胶囊展示 |
| 新建 | `src-web/src/components/Icons/IconPicker.tsx` | 图标选择器 |
| 新建 | `src-web/src/components/Icons/IconRenderer.tsx` | 统一图标渲染 |
| 修改 | `src-web/src/components/Sidebar/Sidebar.tsx` | 底部 Tab 切换、图标渲染 |
| 修改 | `src-web/src/components/Editor/EditorPanel.tsx` | 集成 TagInput |
| 修改 | `src-web/src/App.tsx` | sidebarView 状态 |
| 修改 | `src-web/src/i18n/locales/en.ts` | 新增英文翻译 |
| 修改 | `src-web/src/i18n/locales/zh.ts` | 新增中文翻译 |
| 新建 | `src-web/src/__tests__/tags.test.ts` | 标签单元测试 |
| 新建 | `src-web/src/__tests__/iconRenderer.test.tsx` | 图标渲染测试 |

## 五、实施顺序

1. **Phase A - 数据层**：schema → storage lib → commands → main.rs 注册
2. **Phase B - 前端 IPC + 基础组件**：tauri.ts → IconRenderer → TagBadge
3. **Phase C - 标签系统 UI**：TagPanel → TagInput → Sidebar 集成
4. **Phase D - 图标系统 UI**：IconPicker → Sidebar/Editor 集成
5. **Phase E - i18n + 测试**：翻译 → 单元测试 → 集成测试
6. **Phase F - 构建验证**：tsc → vite build → tauri build

## 六、验证步骤

1. `cargo test -p storage` — 数据库层测试通过
2. `npx tsc --noEmit` — TypeScript 编译通过
3. `npm test` — 所有单元/集成测试通过
4. `npx tauri build` — 完整构建成功
5. 功能验证：
   - 创建标签 → 为笔记添加标签 → 侧边栏切换到标签视图 → 点击标签查看关联笔记
   - 为文件夹设置图标 → 侧边栏文件树中图标正确显示
   - 标签搜索/筛选功能正常
   - 重启应用后标签和图标设置持久化
