# Superset Remix 1.37.7

基于 Superset 的非官方修改版，由独立维护者维护，未获 Superset, Inc. 背书。保留原项目版权与 Elastic License 2.0。

图标改为接近原版的扁平阶梯折线，使用暖黑、米白和淡紫色，统一Dock、安装包、侧栏与菜单栏资源；单一产品名及关于窗口；侧栏不显示常驻修改版标识，修改版说明保留在GitHub。关于窗口可离线显示实际版本、完整原许可证、修改说明与本分支及上游链接。使用全新的 `superset-remix` 独立数据目录，不会自动沿用旧预览版数据。手动从本分支下载更新；不接入官方更新渠道。

保留 SSH 首次连接的后端签名校验、批量上传、管理员安装、launchd 启动、认证 RPC 和断开重连流程。管理员密码仅用于本次安装。后端已可用时复用既有远端实例。品牌修改不更改远端服务合同。

macOS Apple Silicon 使用 `arm64`，Intel 使用 `x64`。文件名前缀为 `Superset-Remix`。Apple Developer ID 和公证尚未配置，当前为 ad-hoc 签名的开发预览。仅通过两种原生 Mac 架构完整验收的产物才上传；未通过构建不是可下载的验证版。新包不更改旧 Release、签名、校验和或 SOURCE 记录。

每种架构附 `SHA256SUMS`、`SOURCE`、`SSH-INSTALL` 和 `BRAND-<arch>` 的实际 UI 截图与测量记录。真实安装包检查两套后端资源、独立公钥、原生 SQLite/PTY、许可、界面和独立目录。源代码测试和 Linux 界面验证不等于 Mac 安装包验收。

本分支不运营上游网站、云服务、移动端和订阅，也未验证 Linux/Windows 发行包。已有物理 Mac 生命周期、真实模型认证及生产发行签名的未验证范围继续见 [SSH 收尾记录](../implementation/ssh-direct-completion-2026-10-12.md)。此预览保持 prerelease，不成为 stable latest。

工作窗口优先复用Superset原版标签栏、窗格/分屏、侧栏、代码编辑器和终端能力；保留SSH文件、Git、聊天/附件/审批、端口与工作区操作，见[UI复用设计](../design/ssh-workspace-upstream-ui-reuse.md)。

新增SSH窗口恢复：保存工作区标签、分屏比例、标题与焦点，退出客户端后只接回原executionId；自动恢复不安装后端、不重启agent、不重发命令。见[窗口恢复验收](../implementation/ssh-workspace-window-restore-2026-10-13.md)。首次安装的当前目标为10秒，尚未稳定达到；见[各方案性能记录](../implementation/ssh-performance-2026-10-13.md)。

1.37.7继续复用原版工作区、标签、分屏、文件编辑/预览、Git和设置组件，补齐本地/SSH数据源。新建worktree统一放在运行机器的 `~/Superset Remix/worktrees/` 下，按项目分组。本地namespace独立保存视图，切换和恢复保持原执行；原终端脚本的四种启动模式、明确创建时触发、Run/Stop及关闭时等待已有请求已接入。

本地和SSH终端共用新的滚动处理：普通终端滚动历史，支持鼠标的TUI保持原生滚动；无鼠标TUI可查看客户端采样保留的有界文本，按Esc返回实时终端，不把滚轮转换成方向键。文本查看不等于Agent内部完整会话或图像重放。客户端文字/PNG/文件粘贴、历史复制与只读查看期间不误发输入已有Linux桌面验证；真实macOS触控板和供应商Agent仍须试用验收。

原CLI的 `agents list`、`projects list`、`workspaces list`、`terminals list`、`terminals read`、`scripts list` 支持显式 `--namespace <绝对目录>`，从执行机器的已有私有后端读取，不要求Superset账号。CLI远端安装、自动目标及其余写命令尚未全部接通。

这是阶段性试用版，**尚未完成全部原版功能对齐**。逐项接入、TDD与真实运行证据见[功能清单](../design/local-ssh-feature-parity.md)和[1.37.7实施报告](../implementation/local-ssh-feature-parity-2026-10-14.md)。源代码验证、安装包启动检查和真实第三方Agent认证分别记录，不互相代替。
