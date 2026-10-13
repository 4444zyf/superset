# SSH 工作窗口复用 Superset 原版界面

2026-10-13，版本 1.37.6。分支 `release-ssh-workspace-restore-1.37.6`，沿用已有 SSH 性能和窗口恢复实现。用户要求优先复用原版布局与已有能力，不继续维护另一套标签栏、分屏和编辑器。

## 组件与连接边界

| 界面能力 | 复用实现 | SSH 接入方式 |
| --- | --- | --- |
| 工作区标签、重命名、关闭其他/全部、重排、溢出滚动 | `@superset/panes` 的 `WorkspaceTabBar` | 本地 main SQLite 视图事务；关闭标签不停止任务 |
| 二叉分屏、窗格标题、焦点、拖拽、分隔条、右键菜单 | 同包 `WorkspaceTab`、Pane、ResizablePanelGroup | 薄适配器映射既有 PaneTree，不另写拖拽/分屏引擎 |
| 窄窗口/大量窗格 | 已有可见窗格调度 | 只显示活动窗格；最多 8 个可见、4 个同时接入；不重写保存的完整树 |
| 侧栏、收起、移动端折叠、按钮、输入框、菜单、提示 | `@superset/ui` | 原有工作区/SSH/项目操作，统一既有主题变量 |
| 代码编辑、语法高亮、查找、折叠、保存快捷键 | 原版 CodeEditor 抽出的 `CodeEditorSurface` | 继续用 `filesystem.readFile/writeFile` 与 `ifMatch`，保留 UTF-8 BOM/CRLF、截断禁写和冲突保留草稿 |
| 终端默认设置、Unicode、剪贴板、搜索、图像、连字、WebGL 回退、滚轮、输入模式恢复 | 原版终端构造器抽出的 `createTerminalSurface`；原版 TerminalSearch | 保留严格 executionId 条件订阅和附着确认；GUI 复用不会改走可 respawn 的普通终端路由 |
| 聊天消息 Markdown | 原版 `@superset/chat-ui/ChatMarkdown` | 继续使用原有 chat 协议 reducer、明确 sessionId、附件和审批操作 |
| 文件、Git 状态/差异、聊天会话、附件、审批 | 既有 RemoteFiles/RemoteChat 和 host-service API | 不复制后端实现；保持所有已有能力检查和异步作用域保护 |
| 端口转发、新会话、刷新、待处理操作查询/确认 | 既有 Workstation API/操作，公用 WorkspacePortControls | 同时供旧本地工作窗口和新 SSH 工作窗口使用；仅明确用户操作执行，恢复不会自动转发或重放 |

编辑器与 Markdown 按需加载。保留主进程有界 SQLite 保存，不为 panes store 新增 localStorage 持久化。实际模型仍是一工作区一个工作区标签；窗格可在同工作区内拖动，跨工作区投放/悬停切换受归属检查约束，不把资源移进不所属的工作区。

`WorkspaceTab` 和 `WorkspaceTabBar` 是原有组件的公开导出；新增可选投放检查，默认不改变原版仪表盘行为。原版代码编辑器仍通过原 wrapper 读取字体/主题，原版终端仍通过原 wrapper 配置本机链接处理；SSH 调用复用相同编辑器/终端底层实现，接入自己的远端传输。

## 恢复与能力范围

继续执行[窗口恢复设计](ssh-workspace-window-restore.md)：只接回原有执行，关闭客户端不停止任务，旧 daemon 没有条件订阅能力则暂停。服务 UID、backend/namespace、目标 revision、executionId、owner/navigation epoch 和 header-only 认证检查不随布局复用而放宽。

完整账号仪表盘的组织、托管主机、计费和云端任务仍依赖其原有账号/云端提供方；不能把缺少数据源的页面装进 SSH 窗口后声称可用。这里复用能够由现有 SSH 后端提供的能力，不删除打包里的代理 CLI/SDK 来缩短安装时间。现有机器维护、本地数据管理、项目创建/克隆、会话与端口操作仍保留。

## 验证

行为单测核对原版 store 调整布局不会更换 resourceId/executionId，空工作区不创建终端，标签重排/重命名只写本地视图。真实 CDP 输入验证远端文件编辑/保存/重新读入、原版终端搜索、侧栏折叠、同工作区窗格拖拽、分屏比例保存，以及退出/重开、离线、显式断开/重试、host/daemon 丢失等生命周期。

本地源码证据与原生冻结 SHA 的发行物证据独立记录，见[实现验收](../implementation/ssh-workspace-window-restore-2026-10-13.md)。性能目标仍按[SSH 性能设计](ssh-connection-performance-progress.md)衡量；复用界面不等于首次全包安装在所有网络上都小于 10 秒。
