# Checklist

## PDF文件加载
- [x] readFileBase64后端函数正确读取文件并返回完整base64数据
- [x] PDFCanvas组件正确解码base64并传给PDF.js
- [ ] PDF文件能够正常渲染显示页面内容
- [x] PDF加载失败时显示友好错误提示

## 笔记内容切换
- [x] CodeMirror编辑器在content prop变化时正确更新内容
- [x] 切换tab时编辑器显示对应笔记的正确内容
- [x] 快速切换多个tab不会出现内容错乱
- [ ] 新开tab异步加载内容期间显示加载状态

## 文件列表完整性
- [ ] vault中的.md文件全部显示在侧边栏
- [ ] vault中的.pdf文件全部显示在侧边栏
- [x] 同一文件不会重复显示
- [x] PDF文件显示特殊图标标识

## 回归测试
- [x] TypeScript编译通过无错误
- [x] Vite前端构建成功
- [ ] Rust后端构建成功（需在外部终端执行）
- [ ] Tauri完整构建成功（需在外部终端执行）
