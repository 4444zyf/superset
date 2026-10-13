# Superset SSH Preview 1.37.3

用于本机验证的开发预览版，采用 ad-hoc 签名，未经 Apple 公证。请在 macOS 系统设置中确认此构建来源后打开。

- Apple Silicon（M1/M2/M3/M4 等）下载文件名包含 `arm64` 的 DMG；Intel Mac 下载 `x64`。
- 应用名称为 **Superset SSH Preview**，拥有独立应用身份和数据目录，可以与原 Superset 并存。
- 新增独立「SSH 机器」页面，支持机器列表、筛选、连接详情与添加/编辑抽屉；可在保存前测试实际 SSH 配置。主机指纹由本机 OpenSSH 验证，首次使用需在系统终端确认。
- 项目与会话创建支持选择运行机器；连接失败时不会向上一台机器提交创建操作。会话内的聊天、文件和终端分为独立标签页，切换标签和自动重连保留未发送的聊天草稿。
- 默认直接进入无账号工作台，可验证本机项目、会话、终端以及退出后任务持续运行。旧数据仅在你显式选择导入时读取。
- 包含 arm64/x64 后端及验证公钥：点击「连接」完成 SSH 验证后，会校验、批量上传、安装并启动缺失的后端，再建立连接。已有可用后端会直接复用。首次安装需要目标 Mac 的管理员授权，可在「连接信息」填写仅用于本次操作的管理员密码。
- 修复 SFTP 沿用 `SessionType=default` 导致 OpenSSH 拒绝子系统请求的问题。后端文件通过单次 SFTP 会话批量上传；传输和安装失败时保留有界的原始错误，便于定位。
- TXT 附件可以上传和下载；当前 Codex harness 会省略 TXT 并明确提示，不表示模型读取了附件。

CI 先在对应原生 Mac 架构上构建并签名两套后端，再按公钥校验并装入每个 DMG。实际挂载后的验证检查两套后端清单、签名、文件摘要、版本和可执行权限，并运行当前架构后端的原生 smoke；同时检查应用身份、ad-hoc 签名、包内 SQLite/PTY 与 CLI。还会使用包内 Electron 运行时、真实 OpenSSH/SFTP 和全新的 runner 后端环境，验证首次上传、管理员安装、launchd 启动、认证 RPC、断开重连及重新创建客户端后复用同一后端实例。下载附件附有 `SHA256SUMS-*.txt`、`SOURCE-*.txt` 和 `SSH-INSTALL-*.json` 验收记录。只有两种架构全部通过后才允许发布 prerelease；源码检查通过不代表安装包或完整连接链路已通过。

完整实现和已有 Linux 验收范围见 [SSH 收尾记录](../implementation/ssh-direct-completion-2026-10-12.md)。尚未完成物理 Mac 生命周期、真实模型认证及生产签名后端的实机验收。本预发布不成为 stable latest，也不触发生产 CLI 发布。

维护者：推送 `release/ssh-preview-*` 分支会执行 `Release SSH Desktop Preview`。已经推送但 Actions 当时未启用的分支，需要重新推送新提交来触发；不必合并到 main。预览后端使用独立的 `build-direct-preview.yml`：每个原生 Mac worker 在构建前生成临时 Ed25519 密钥，私钥仅以 0600 权限保存到临时目录，封存后删除，不上传或进入应用。公钥通过 workflow outputs 传给桌面构建，固定到客户端；打包、上传及远端安装继续验证签名、清单与文件摘要。可执行文件和外层应用采用 ad-hoc 签名，不执行 Apple 公证。此流程不需要 GitHub 签名 secrets 或 Apple Developer ID 证书；它提供构建内完整性校验，不提供生产发行身份。正式 `build-direct.yml` 仍强制使用独立配置的签名密钥与 Developer ID 证书。

手动触发工作流默认仅构建并上传经过验证的 artifacts；选择 `publish` 才发布 prerelease。已发布的 1.37.2 不会因源码修改获得这些资源；发布修复需要按 runbook 使用新版本号。
