# Superset Remix 1.37.6

基于 Superset 的非官方修改版，由独立维护者维护，未获 Superset, Inc. 背书。保留原项目版权与 Elastic License 2.0。

图标重新设计为白色与蓝紫色折带S，统一Dock、安装包、侧栏与菜单栏资源；单一产品名及关于窗口；侧栏不显示常驻修改版标识，修改版说明保留在GitHub。关于窗口可离线显示实际版本、完整原许可证、修改说明与本分支及上游链接。使用全新的 `superset-remix` 独立数据目录，不会自动沿用旧预览版数据。手动从本分支下载更新；不接入官方更新渠道。

保留 SSH 首次连接的后端签名校验、批量上传、管理员安装、launchd 启动、认证 RPC 和断开重连流程。管理员密码仅用于本次安装。后端已可用时复用既有远端实例。品牌修改不更改远端服务合同。

macOS Apple Silicon 使用 `arm64`，Intel 使用 `x64`。文件名前缀为 `Superset-Remix`。Apple Developer ID 和公证尚未配置，当前为 ad-hoc 签名的开发预览。仅通过两种原生 Mac 架构完整验收的产物才上传；未通过构建不是可下载的验证版。新包不更改旧 Release、签名、校验和或 SOURCE 记录。

每种架构附 `SHA256SUMS`、`SOURCE`、`SSH-INSTALL` 和 `BRAND-<arch>` 的实际 UI 截图与测量记录。真实安装包检查两套后端资源、独立公钥、原生 SQLite/PTY、许可、界面和独立目录。源代码测试和 Linux 界面验证不等于 Mac 安装包验收。

本分支不运营上游网站、云服务、移动端和订阅，也未验证 Linux/Windows 发行包。已有物理 Mac 生命周期、真实模型认证及生产发行签名的未验证范围继续见 [SSH 收尾记录](../implementation/ssh-direct-completion-2026-10-12.md)。此预览保持 prerelease，不成为 stable latest。

工作窗口优先复用Superset原版标签栏、窗格/分屏、侧栏、代码编辑器和终端能力；保留SSH文件、Git、聊天/附件/审批、端口与工作区操作，见[UI复用设计](../design/ssh-workspace-upstream-ui-reuse.md)。

新增SSH窗口恢复：保存工作区标签、分屏比例、标题与焦点，退出客户端后只接回原executionId；自动恢复不安装后端、不重启agent、不重发命令。见[窗口恢复验收](../implementation/ssh-workspace-window-restore-2026-10-13.md)。首次安装的当前目标为10秒，尚未稳定达到；见[各方案性能记录](../implementation/ssh-performance-2026-10-13.md)。
