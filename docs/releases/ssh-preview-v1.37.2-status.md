# SSH Preview 1.37.2

1.37.2 按确认的 HTML 原型加入独立 SSH 机器管理入口、列表与详情、添加/编辑抽屉以及工作区运行位置选择。项目创建和会话创建使用所选机器的实时连接，失败不会回退到另一台机器执行。连接设置保存在本机；测试未保存配置只执行 OpenSSH 探测，不保存配置或安装服务。

首次 SSH 使用系统终端确认主机指纹，保持原来的严格 OpenSSH 校验。断开和切换只关闭客户端连接；Stop 继续使用 main 中针对目标身份的原生确认。连接详情中保留后端维护和本地命名空间/旧数据导入入口。切换聊天、文件、终端标签与自动重连保留当前会话的聊天草稿。

UI 采用原型的深色外观、侧栏、列表与详情布局。启动时读取系统语言，新增文案补齐全部 17 个语言目录。已用真实 Electron 窗口验证中文显示；本地数据维护表单收纳到连接信息，不出现在默认机器详情的工作区标签里。

本地验证：Desktop 工作台与 SSH main 回归共 109 pass；direct-connection 连接回归 26 pass；完整 Desktop 类型检查、Lingui 严格编译、统一版本、Biome、plugin、Desktop compile:app 通过。新增页面/跨机器创建保护测试先失败后通过；聊天草稿在标签切换时丢失的回归先失败，修复后通过。

Linux 实际界面验证使用当前编译后的 Electron、UID 1000 的直接后端与 OpenSSH loopback，保持主机密钥校验。未使用环境中的外部 SSH 密码或真实模型凭证。验证了未保存配置探测、添加机器、连接、创建会话/终端、断开后任务增长、重连已有会话、原生 Quit 后远端 PID/启动身份不变且终端心跳继续增长、重开恢复 SSH 配置、创建所选机器上的项目与项目会话。截图与 DOM 观察一致，验证期间无 JavaScript 控制台错误。Linux GUI 需要云环境的 `--no-sandbox`；该开关不加入发行包。此验证不等同于物理 Mac 或真实模型认证验收。

Desktop、host-service 与 CLI 为 1.37.2，PTY daemon 仍为 0.3.7。发布继续使用现有开发预览流程：两个原生 Mac runner 构建、只读挂载实际 DMG、检查签名/架构/应用数据隔离及包内 SQLite、PTY、CLI 后，才发布 `ssh-preview-v1.37.2` prerelease。此版仍为 ad-hoc 签名、未经公证，不包含远端 Mac 自动安装的签名后端资源。

[构建 38224543953](https://github.com/4444zyf/superset/actions/runs/38224543953)的 arm64、x64 与发布任务均已成功。[1.37.2 Release](https://github.com/4444zyf/superset/releases/tag/ssh-preview-v1.37.2)已发布，非 draft、为 prerelease，不成为 stable latest。tag 与两份 SOURCE 均指向 `8da8d2901bc75a7ed82b8fc1b17fbf68df19c858`。两个 Mac 的实际包内 SDK 输出版本均为 1.37.2、Electron ABI 145、SQLite/PTY pass、managedBackendResources false。

| 产物 | 字节数 | SHA256 |
| --- | --- | --- |
| Superset-SSH-Preview-1.37.2-arm64.dmg | 354592924 | `80096e2d88f020516f76dd1eeffca58d680e0f769daf4e036c45f0ae5f7da042` |
| Superset-SSH-Preview-1.37.2-x64.dmg | 364989575 | `0b9557d18d3da3ab3c4cd9440f0c471af5dcc8f713b3463e100d526a3491d167` |

发布后下载两份 SOURCE 和 SHA256SUMS，发布资产服务端 digest 均与 checksum 一致；ARM64 artifact 另行实际下载，字节数与 SHA256 和发布资产一致。未额外下载完整 x64 DMG。结构化记录见 [发布证据](ssh-preview-v1.37.2-evidence.json)。验证用的 GUI、SSH、后端和终端任务已清理。
