# 开发预览 DMG 准备记录

日期：2026-10-12（北京时间）。用户选择先发布开发预览版，下载后自行验证。

源码基于 `81a0311d8`，使用独立 `release/ssh-preview-1.37.1` 分支。Desktop、host-service、CLI 统一为 `1.37.1`，PTY daemon 为 `0.3.7`；仅更新 lockfile 对应 workspace 版本，依赖版本不变。

预览配置采用独立的 `appId`、打包 metadata productName/name 和协议，保持不同的 userData。显式开发打包仍使用原生产 beforePack 校验：不能携带残留后端或公钥资源。正式签名流程没有改成开发模式。预览只做 ad-hoc 签名，不公证，也不提供远端 Mac 自动安装资源。

`Release SSH Desktop Preview` 在 arm64/x64 对应原生 Mac runner 上各自打包，实际校验并只读挂载 DMG，检查架构、应用身份、签名、ASAR 入口/迁移以及 SQLite/PTY 和 CLI；两者全部成功才发布 `ssh-preview-v1.37.1` prerelease，附 SHA256 和源码 commit，不成为 latest。不匹配源码或状态的同名 Release 会被拒绝。

本地检查：配置回归从缺失独立 package productName 的失败变为通过；配置及既有生产打包门禁共 3 pass/10 assertions。发行版本逻辑 15 pass/21 assertions；统一版本、完整 Desktop 类型、Desktop compile:app、Biome、Bash/Node 语法、actionlint、plugin 检查通过。独立只读复核确认发布状态门禁、应用数据隔离和原生产校验；建议补充的后端/worker/migration 产物完整性检查已加入。没有重建共享 Electron native binding。

推送前 GitHub 仓库内容读写可用，但 Actions API 返回 0 个已登记 workflow，现有源文件存在。派发返回404，启用 Actions 请求返回403 `Resource not accessible by integration`。签名环境列表为空，仓库 secret 名称查询也被403拒绝，因此不把它解释为所有仓库 secret 都不存在。

推送 `7d309a8ac` 后，新 workflow 自动登记并开始运行，无需手动启用旧 workflow。[Mac 构建 38209817738](https://github.com/4444zyf/superset/actions/runs/38209817738)的两个原生架构及发布 job 均成功；最终由此 workflow 在两者完成后发布 [ssh-preview-v1.37.1](https://github.com/4444zyf/superset/releases/tag/ssh-preview-v1.37.1)，没有合并 main。

两个 DMG 均通过实际 `hdiutil verify`、只读挂载、ad-hoc 签名验证、包内独立身份/入口/migration 检查、原生 SQLite/PTY 和 CLI。SDK 输出都为版本1.37.1、Electron ABI145、SQLite/PTY pass、managedBackendResources false。此 SDK 检查不等同于原生 GUI 的退出/重连或实际模型认证验收。

| 产物 | 字节数 | SHA256 |
| --- | --- | --- |
| Superset-SSH-Preview-1.37.1-arm64.dmg | 354406888 | `bb6827443e264cc56689a0f1571e402b9080ad2e6c0a0eee4b60a9a295e932c0` |
| Superset-SSH-Preview-1.37.1-x64.dmg | 364853044 | `328e65f456c74a6f8b473acdbf2bf4f216df02c309de243923d8e9295859155b` |

发布后另行下载两份 SOURCE 和 SHA256SUMS，源码均为 `7d309a8acb4dc06a6d0818e74b7b3c419872299f`；GitHub 已上传资产的服务端 digest 与对应 checksum 一致。ARM64 artifact 实际下载后的字节数和 SHA256 也相同。Release 为非 draft 的 prerelease，tag 指向同一源码；未公证、不含远端自动安装资源。可审阅的元数据见 [发布证据](ssh-preview-v1.37.1-evidence.json)。

开发预览版的说明见 [发布说明](ssh-desktop-preview.md)。之前 Linux 实现与验收证据保留原检查点，不声称本轮版本更新已经通过新的 Mac 实机验收。
