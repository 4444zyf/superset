<div align="center">
<img src="../assets/branding/icon-128.png" alt="Superset Remix" width="96" height="96" />

# Superset Remix
</div>

本地和 SSH 工作站。Superset 的非官方修改版本，由独立维护者维护，未获 Superset, Inc. 背书。

当前桌面端直接打开无需账号的工作站。添加 SSH 机器并连接，缺少后端时会自动上传并安装随应用附带、经过签名验证的后端。首次安装可能需要远端管理员密码。断开桌面连接后，远端任务继续运行。

macOS Apple Silicon 和 Intel 预览安装包分别构建和验证；尚未发布的构建可在 GitHub Actions 的产物中下载。以产物内的版本、源码提交和校验和为准。旧版 Superset SSH Preview 下载属于品牌修改之前的历史版本。Linux 和 Windows 发行包尚未验证。

使用全新的 superset-remix 独立数据目录，不会自动导入旧预览版或上游数据。通过本仓库的下载页手动更新。尚未配置 Apple Developer ID 签名和公证；当前为临时签名的开发预览。

界面中的“非官方修改版本”按钮打开关于窗口，可离线查看实际版本、完整原始许可、修改说明及上游与分支链接。上游网站、云服务、移动端和订阅不由此分支运营。

[Downloads](https://github.com/4444zyf/superset/releases) · [Issues](https://github.com/4444zyf/superset/issues) · [Development](../DEVELOPMENT.md) · [English](../README.md)

[Upstream Superset](https://github.com/superset-sh/superset) · [Elastic License 2.0](../LICENSE.md) · [FORK_NOTICE.md](../FORK_NOTICE.md) · [Scope / audit](../docs/design/branding-audit.md)
