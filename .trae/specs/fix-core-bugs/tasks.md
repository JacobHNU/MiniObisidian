# Tasks

- [x] Task 1: 修复PDF文件加载 - 解决InvalidPDFException问题
  - [x] SubTask 1.1: 检查readFileBase64后端函数，确认文件读取和base64编码逻辑正确
  - [x] SubTask 1.2: 检查IPC传输链路，确认base64字符串在Tauri IPC序列化/反序列化过程中无损
  - [x] SubTask 1.3: 修复PDFCanvas组件的base64解码逻辑，添加数据完整性校验
  - [x] SubTask 1.4: 添加PDF加载失败时的友好错误提示和重试机制

- [x] Task 2: 修复笔记切换内容错乱 - 解决CodeMirror状态管理问题
  - [x] SubTask 2.1: 分析CodeMirrorEditor组件的useEffect依赖，确保content变化时正确触发更新
  - [x] SubTask 2.2: 修复EditorPanel中content prop传递链路，确保activeTabId变化时content同步更新
  - [x] SubTask 2.3: 确保tabContents状态在tab切换时正确清空旧内容并加载新内容
  - [x] SubTask 2.4: 验证多笔记快速切换场景下内容显示正确

- [x] Task 3: 修复vault文件扫描 - 确保.md和.pdf文件完整列出
  - [x] SubTask 3.1: 检查scan_directory_incremental函数，确认.md和.pdf文件都被正确扫描
  - [x] SubTask 3.2: 检查list_notes数据库查询，确认返回所有已索引文件
  - [x] SubTask 3.3: 确认upsert_note基于path去重逻辑正确工作
  - [x] SubTask 3.4: 验证前端Sidebar组件正确接收并显示所有文件类型

- [ ] Task 4: 全场景回归测试
  - [ ] SubTask 4.1: 测试PDF文件打开、缩放、翻页功能
  - [ ] SubTask 4.2: 测试多笔记快速切换，验证内容对应正确
  - [ ] SubTask 4.3: 测试vault文件列表完整性，包含.md和.pdf文件
  - [ ] SubTask 4.4: 测试文件去重，确认同一文件不重复显示

# Task Dependencies
- Task 1, Task 2, Task 3 可并行执行
- Task 4 依赖 Task 1, Task 2, Task 3 全部完成
