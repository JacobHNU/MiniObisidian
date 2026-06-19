# 核心功能故障修复 Spec

## Why
笔记软件存在三个核心功能故障：PDF文件无法加载查看、多笔记切换时内容错乱显示、vault文件扫描不完整。这些问题严重影响用户体验，需要系统性修复。

## What Changes
- 修复PDF文件加载流程：解决base64传输过程中数据损坏导致的InvalidPDFException
- 修复笔记内容状态管理：解决CodeMirror编辑器在tab切换时内容不更新的问题
- 修复vault文件扫描：确保.md和.pdf文件都能被正确索引和列出
- 修复文件去重逻辑：解决同一笔记重复显示的问题

## Impact
- Affected specs: PDF查看功能、笔记编辑功能、文件管理功能
- Affected code:
  - `src-web/src/components/PDF/PDFCanvas.tsx` - PDF渲染组件
  - `src-web/src/components/Editor/EditorPanel.tsx` - 编辑器面板
  - `src-web/src/components/Editor/CodeMirrorEditor.tsx` - CodeMirror编辑器
  - `src-web/src/App.tsx` - 主应用状态管理
  - `src-web/src/components/Sidebar/Sidebar.tsx` - 侧边栏文件列表
  - `src-tauri/src/commands.rs` - 后端命令
  - `crates/note-core/src/service.rs` - 笔记服务
  - `crates/storage/src/lib.rs` - 数据库存储

## ADDED Requirements
### Requirement: PDF文件可靠加载
系统 SHALL 能够正确加载并渲染vault中的PDF文件，确保base64数据在传输过程中不损坏。

#### Scenario: 打开PDF文件
- **WHEN** 用户点击侧边栏中的PDF文件
- **THEN** 系统通过readFileBase64读取文件原始字节，转为base64传递给前端，PDFCanvas组件正确解码并渲染PDF页面

#### Scenario: PDF数据完整性
- **WHEN** PDF文件通过IPC传输到前端
- **THEN** base64数据完整无损，PDF.js能够正确解析PDF结构

### Requirement: 笔记切换内容正确
系统 SHALL 在切换不同笔记tab时，正确加载并显示对应笔记的内容。

#### Scenario: 切换笔记tab
- **WHEN** 用户点击不同的笔记tab
- **THEN** 编辑器和预览区显示该笔记的正确内容，不显示其他笔记的内容

#### Scenario: 新开tab加载内容
- **WHEN** 用户从侧边栏打开一个新笔记
- **THEN** 系统创建新tab，异步加载笔记内容，加载完成后正确显示

### Requirement: 文件列表完整
系统 SHALL 在侧边栏中完整列出vault内所有.md和.pdf文件。

#### Scenario: 扫描vault文件
- **WHEN** 用户打开vault
- **THEN** 侧边栏显示所有.md笔记文件和.pdf文档文件，无遗漏

## MODIFIED Requirements
### Requirement: 文件去重
upsert_note SHALL 基于文件路径(path)而非ID进行去重，确保同一文件不会重复显示。

## REMOVED Requirements
无
