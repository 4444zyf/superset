# Superset SSH Preview

用于本机验证的开发预览版，采用 ad-hoc 签名，未经 Apple 公证。请在 macOS 系统设置中确认此构建来源后打开。

- Apple Silicon（M1/M2/M3/M4 等）下载文件名包含 `arm64` 的 DMG；Intel Mac 下载 `x64`。
- 应用名称为 **Superset SSH Preview**，拥有独立应用身份和数据目录，可以与原 Superset 并存。
- 默认直接进入无账号工作台，可验证本机项目、会话、终端以及退出后任务持续运行。旧数据仅在你显式选择导入时读取。
- 不包含远程 Mac 自动安装所需的签名后端。SSH 只能连接已经独立安装并配置可信后端的目标；本包不能把一台全新 Mac 自动准备为远端后端。
- TXT 附件可以上传和下载；当前 Codex harness 会省略 TXT 并明确提示，不表示模型读取了附件。

CI 在对应原生 Mac 架构上打包，实际挂载并验证 DMG、应用身份、ad-hoc 签名、包内 SQLite/PTY 与 CLI。发布页附有 `SHA256SUMS-*.txt` 和 `SOURCE-*.txt`。只有两种架构全部通过后才发布可下载的 GitHub prerelease；源码检查通过不代表 DMG 已构建成功。

完整实现和已有 Linux 验收范围见 [SSH 收尾记录](../implementation/ssh-direct-completion-2026-10-12.md)。尚未完成物理 Mac 生命周期、真实模型认证及生产签名后端的实机验收。本预发布不成为 stable latest，也不触发生产 CLI 发布。

维护者：启用仓库 Actions 后，推送 `release/ssh-preview-*` 分支会执行 `Release SSH Desktop Preview`。已经推送但 Actions 当时未启用的分支，需要重新推送新提交来触发；不必合并到 main。工作流不使用生产环境、Apple 证书或私有后端签名密钥。
