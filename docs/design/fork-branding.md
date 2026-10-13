# Superset 修改版品牌设计与实施方案

日期：2026-10-13。状态：当前桌面、仓库与 macOS 预览分发已实施；[实施与验收记录](../implementation/fork-branding-2026-10-13.md)包含真实截图和双架构原生验收结果。本文保留原设计要求，旧数据兼容部分按下面的用户决定替代。

**实施时的用户决策（2026-10-13）：按全新安装处理，不兼容或迁移旧预览版数据。第 8.2 节及第 13.3 节的旧数据沿用与升级兼容检查被此决定替代；新产品和开发环境使用各自独立的新目录。原技术协议、上游版权和许可要求继续适用。**

**后续用户决定（2026-10-13）：主界面不显示「非官方修改版」常驻提示，修改版说明放在 GitHub README 与修改说明中。原常驻标识要求被此决定替代；侧栏使用普通「关于」入口，原版权、完整许可证与安装包内修改说明保留。**

## 1. 目标与已确定的方向

让用户在看到仓库、下载安装包和打开应用时，都能判断这是基于 Superset 的非官方修改版，知道本分支提供什么、到哪里下载和反馈问题，同时保留上游的作者、许可和贡献归属。

- 只使用一个产品名，不增加产品副标题。SSH 是功能与连接状态，不成为名称后面的第二行品牌文案。
- 保留现有简洁、深色、几何符号的视觉风格，小幅调整 Logo，体现本地与 SSH 远程工作台的特色。
- 主界面使用普通「关于」入口；修改版说明放在 GitHub README 与修改说明中。
- 覆盖产品界面、操作系统标识、代码中的展示名称、资源、仓库说明、反馈入口和发布链路。
- 按引用的实际用途处理 `Superset`，而不是全仓替换字符串。上游署名、技术协议和历史记录有明确的保留规则。

**本次实施暂采用工作名 `Superset Remix`，用户尚未确认另一个最终名称。** 名称替换不改变本方案的视觉、署名、兼容性和验收要求。最终名称与 slug 在第一阶段确定一次，此后从统一品牌配置读取。

## 2. 许可与来源表达

当前根目录 `LICENSE.md` 是 Elastic License 2.0（ELv2），结尾包含 `Copyright 2025-2026 Superset, Inc.`。实施时以仓库实际许可证为准，不能将本项目写成 MIT、Apache 或无条件的自由软件。

与本次修改直接相关的原文：

> You may not alter, remove, or obscure any licensing, copyright, or other notices of the licensor in the software. Any use of the licensor's trademarks is subject to applicable law.

> You must ensure that anyone who gets a copy of any part of the software from you also gets a copy of these terms.

> If you modify the software, you must include in any modified copies of the software prominent notices stating that you have modified the software.

实施规则：

1. 保留原 `LICENSE.md`、版权及第三方许可文件。修改说明单独新增，不能覆盖原署名。
2. 仓库首页、修改说明和发布说明表明经过修改及非官方身份；应用主界面不增加常驻提示。
3. 统一用「基于 Superset 的非官方修改版」或英文 `An unofficial modified version of Superset`；「魔改」可以出现在交流说明中，不作为正式法律或来源文案。
4. 不暗示 Superset 官方发布、维护、赞助或认可本分支。保留名称中的 Superset 或参考其图形不代表获得额外商标授权。
5. 不通过品牌修改绕过许可证、许可密钥功能或受其保护的功能。本次工作只处理身份与展示。
6. 安装包内随附完整原许可证与修改说明，应用离线时也能查看。下载附件和源码分发也附带许可。

建议新增 `FORK_NOTICE.md`，记录本分支名称、仓库、主要改动、上游地址和原版权。它是补充说明，不替代 `LICENSE.md`。新增代码与设计贡献可另行署名，不将 Superset, Inc. 写成维护本分支的主体。

## 3. 品牌字段与链接归属

| 字段 | 方案值或约束 | 用途 |
| --- | --- | --- |
| `displayName` | `Superset Remix`，工作名 | 应用、README、发布标题的唯一产品名 |
| `slug` | `superset-remix`，随最终名称确定 | 新安装包元数据、资源命名 |
| `artifactStem` | `Superset-Remix`，随最终名称确定 | 新发布文件，例如 `<stem>-<version>-<arch>.dmg` |
| `forkRepository` | `https://github.com/4444zyf/superset` | 当前 `origin` 已核实；未来仓库迁移时一起更新 |
| `forkIssues` | 本分支仓库的 `/issues` | 修改版问题反馈 |
| `forkReleases` | 本分支仓库的 `/releases` | 没有确认具体版本前使用版本列表 |
| `upstreamName` | `Superset` | 来源、致谢、兼容说明 |
| `upstreamRepository` | `https://github.com/superset-sh/superset` | 上游源码及贡献归属 |
| `upstreamDocs` | `https://docs.superset.sh` | 明确标为「Superset 上游文档」 |
| `upstreamCopyright` | 保留实际原版权文本 | 许可证、关于页面、分发资源 |
| `desktopAppId` | 建议使用维护者身份下的独立 ID，如 `io.github.4444zyf.superset-remix` | 与官方应用隔离；切换前完成第 8 节兼容工作 |
| `desktopScheme` | 建议新使用 `superset-remix` | 只有实际支持的链接才注册；旧预览链接另行验证 |

不设置 `subtitle`、`tagline` 或 `edition` 字段。产品名统一大小写，不在侧栏额外派生一个小写名称。

本分支暂不假设拥有官网、客服邮箱、隐私政策站点、Discord 或 App Store 产品。没有真实可用的入口就省略，不把上游服务改写成维护者自己的服务，也不生成虚构域名。

`/releases/latest` 通常选择非预发布版本。当前预览发布使用 prerelease 和 `--latest=false`，因此下载按钮应指向已核实的具体预览版本，或本分支 `/releases`；不能仅把 README 中的上游 owner 换掉后沿用 `latest`。

## 4. 视觉规范

### 4.1 现状与调整

已检查实际资源：`apps/desktop/src/resources/build/icons/icon.png` 是黑底圆角方形和浅色像素括号图形；工作台 `WorkstationShell.tsx` 的内联 SVG 则是三层线条图形。二者目前不一致，需要统一。

新图形沿用黑底、浅色几何块面、克制的圆角与轮廓感，用两个可区分的几何端点和一个连接细节表达「本地 ↔ 远端」。从现有像素几何语言出发重新绘制，形成可辨识的修改版轮廓，不只是给原图标叠一个小贴纸。

- 只引入一个主要变化：连接关系。不要同时堆叠 SSH 字样、终端符号、网络节点和版本角标。
- 16–32 px 的版本只保留清晰轮廓，去掉细小高光与纹理；菜单栏使用单色模板图标。
- 主界面颜色以 `workstation.css` 为基础：背景 `#17181b`、侧栏 `#121316`、正文 `#ededef`、强调色 `#b9adff`。绿色只表达运行或连接状态，不改为品牌色。
- 品牌文字保持现有无衬线字体，不额外增加字体依赖。名称不因容器窄而改成另外一个品牌。
- 浅色页面和邮件另提供深色单色图形，不能只反转整张黑底应用图标。

### 4.2 需要交付的资源

建议新增 `assets/branding/`，保存本分支可编辑的矢量母版、单色版本、应用图标母版及资源生成说明。以下是交付物，不是已经存在的文件：

| 资源 | 规格与用途 |
| --- | --- |
| 图形母版 SVG | 独立图形，可无损缩放；记录画布、安全区和颜色 |
| 水平组合 SVG | 图形 + 唯一产品名，不带副标题 |
| 单色 SVG | 正反两种颜色，用于侧栏、文档和菜单栏 |
| 应用图标 PNG | 1024 × 1024 母版，透明区域按平台需要保留 |
| `.icns` / `.ico` | 从母版导出平台所需尺寸，不能只改扩展名 |
| Dev / Canary 图标 | 使用同一图形，通过已有渠道标记区分，不另起产品名 |
| favicon 与 touch icon | 为本分支实际启用的网站导出所需尺寸 |
| README 图形 | 使用仓库内资源及相对路径，离线查看源码仍可获得图形 |

新增 `scripts/generate-brand-assets.*` 时明确工具、版本、输入和输出，不依赖生成式工具随机重画每一个尺寸。安装包、README、界面内联图形必须能追溯到同一母版。

## 5. 界面规范

| 场景 | 目标行为 |
| --- | --- |
| 工作台侧栏 | 新 Logo + 唯一产品名；不加第二行产品副标题 |
| 标题栏与窗口标题 | 使用唯一产品名；已有 `Direct SSH` 若保留，只表示功能或状态 |
| 关于入口 | 侧栏底部使用普通「关于」按钮，不显示「非官方修改版」常驻提示 |
| 关于 | 展示名称、实际应用版本、构建来源（有数据时）、修改版说明、本分支源码/反馈、上游源码、原版权与完整许可证 |
| 启动及错误页面 | 使用新名称；继续使用现有 `FailureLayout` 与错误边界，不引入需要 IPC 或联网才能显示的品牌组件 |
| 本机权限提示 | 若相应权限仍被应用使用，文案以新名称为主体；不为了改品牌新增权限 |
| macOS 菜单、Dock、托盘 | 名称与图形一致；仅调整当前入口实际使用的菜单和托盘，不重新接入旧云端启动链路 |
| 帮助、反馈、更新 | 修改版入口默认进入本分支；上游资料明确标注来源 |
| 无障碍文本 | 独立可读图形使用新名称作为可访问名称；与相邻品牌文字重复的装饰图形保持隐藏 |

关于页面正文示例，最终名称由品牌字段替换：

> Superset Remix 是基于 Superset 的非官方修改版，包含本分支对本地工作台、SSH 远程连接与后端安装流程的修改。本分支独立维护，未经 Superset 官方背书。原项目版权与 Elastic License 2.0 保留。

关于不应在每次启动时弹窗，也不增加确认或接受协议的额外流程。

当前 `direct-app.ts` 禁止窗口导航和新窗口；关于中的外部链接需要通过受限 IPC 打开系统浏览器。只允许固定的 `forkRepository`、`forkIssues`、`forkReleases`、`upstreamRepository` 等链接 ID，主进程解析为已知 HTTPS 地址，不开放任意 URL 执行，也不放宽现有 CSP。

## 6. 已核实的代码与资源入口

下面的路径相对于仓库根目录。每项说明替换范围及需要注意的关联；实施开始时重新扫描，补充后来新增的入口。

### 6.1 当前桌面产品：第一批必须完成

| 现有路径 | 现状及执行动作 |
| --- | --- |
| `apps/desktop/src/main/index.ts` | 当前启动 `startWorkstation`；沿该入口实施，不把旧云端 UI 当成当前产品 |
| `apps/desktop/src/renderer/index.tsx` | 当前根页面是 `Workstation`；用于确认视觉验收覆盖真实入口 |
| `apps/desktop/src/main/direct-app.ts` | 窗口标题硬编码 `Superset`；改为品牌常量；品牌初始化必须早于单实例锁和数据目录初始化 |
| `apps/desktop/src/renderer/workstation/Workstation/components/WorkstationShell/WorkstationShell.tsx` | 标题栏 `Superset`、侧栏 `superset`、内联 SVG；统一名称、图形和关于入口 |
| `apps/desktop/src/renderer/workstation/Workstation/workstation.css` | 现有品牌尺寸与色板；只增加来源标识、长名称适配等必要样式 |
| `apps/desktop/src/renderer/index.html` | 当前没有 `<title>`；随构建使用统一名称，避免增加另一处手工常量 |
| `apps/desktop/src/renderer/lib/boot-errors.ts` | 启动失败标题包含 Superset；使用无依赖品牌字段 |
| `apps/desktop/src/renderer/components/RendererErrorBoundary/RendererErrorBoundary.tsx` | 错误正文含旧名称；保持 provider-free 的恢复能力 |
| `apps/desktop/package.json` | `productName`、description、repository 等元数据；展示名称改新品牌，源码仓库指向本分支；不删除原贡献者归属 |
| `apps/desktop/electron-builder.preview.ts` | 当前覆盖为 `Superset SSH Preview`、独立 appId、scheme、文件名；从同一品牌源生成，保持后台资源和验证要求 |
| `apps/desktop/electron-builder.ts` | appId、图标、版权、权限提示、平台产物名；按本分支发布策略适配，原版权不能被维护者名称顶替 |
| `apps/desktop/electron-builder.canary.ts` | 渠道覆盖；若在本分支继续发布，同步名称与图形并保留独立渠道身份 |
| `apps/desktop/src/resources/build/icons/` | PNG、ICNS、ICO 及 Dev/Canary 版本；替换当前分发资源并保存可编辑母版 |
| `apps/desktop/src/resources/tray/iconTemplate.png` | 如该入口启用托盘，使用新图形的单色模板版本 |
| `apps/desktop/src/resources/build/installer/background.tiff` | 检查图中是否含旧品牌，重新输出背景；不能靠改文件名完成替换 |
| `apps/desktop/src/resources/browser-extension/manifest.json` | 当前名称为 `Superset Browser Tools`，描述也含旧品牌；若随产品分发，改展示名称和描述，保留功能与权限范围 |
| `apps/desktop/src/preload/index.ts`、`apps/desktop/src/shared/direct-workstation.ts` | 为关于版本信息、固定外部链接等增加最小 API，保持类型和输入校验 |

建议将 `BrandMark/BrandMark.tsx` 和 `AboutDialog/AboutDialog.tsx` 放在 `Workstation/components/` 下，各自使用目录及 barrel export。跨页面复用后再按仓库规范上移。失败页面仅使用纯数据名称，不导入工作台弹窗或其依赖。

### 6.2 代码内的其他品牌入口：必须分类处理

| 现有路径 | 执行规则 |
| --- | --- |
| `packages/shared/src/constants.ts` | 当前 `COMPANY` 混合名称、上游网站、反馈、商店及下载；拆分产品身份与上游服务，不能把 `COMPANY.NAME` 一改了事 |
| `packages/shared/package.json` | 为新的纯数据品牌适配模块添加明确 export |
| `apps/desktop/src/main/legacy-cloud.ts` | 旧入口的标题、退出文案；如仍可独立启动，接入本分支品牌；保留其明确描述上游账号的文本 |
| `apps/desktop/src/main/lib/menu.ts`、`tray/index.ts`、`quit-completely.ts` | 菜单、托盘 tooltip、退出提示含名称；接入实际使用入口时统一替换 |
| `apps/desktop/src/main/lib/dock-icon.ts` | 运行时 Dev/Canary 图标选择；与新资源对应 |
| `apps/desktop/src/main/lib/auto-updater.ts` | feed 硬编码上游；目前不由新的主入口直接启动，按第 9 节处理，防止以后误接回上游更新 |
| `apps/desktop/scripts/patch-dev-protocol.ts`、`packages/shared/src/dev-app-profile.ts` | Dev 名称、协议、旧目录清理规则；改展示名称时保留兼容识别范围，不能扩大清理范围 |
| `apps/desktop/src/renderer/routes/sign-in/components/SupersetLogo/` | 旧入口图形、`aria-label`、SVG 标题；产品图形改为新母版，上游登录身份仍如实描述 |
| `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/assets/superset-empty-state-wordmark.svg` | 旧工作区空状态资源；替换本分支展示用途，历史截图不跟着重写 |
| `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/ToolbarMenuButton/` | 旧产品的帮助/反馈/外部入口；按链接归属拆分 |
| `apps/desktop/src/renderer/screens/main/components/WorkspaceSidebar/WorkspaceSidebarFooter.tsx` | 检查页脚、社区与服务来源；不冒用上游团队支持身份 |
| `packages/ui/src/assets/icons/preset-icons/superset.svg` | 作为「上游 Superset」预设图标时保留；如展示本分支产品，则单独新增新图标 |
| `packages/ui/src/components/ProFeaturesDialog/`、`AppStoreQr/` | 上游 Pro/手机服务归上游；不用品牌替换伪装成本分支已提供的服务 |
| `packages/i18n/locales/*/messages.po`、`packages/i18n/glossary.md` | 所有发货语言同步来源/关于/菜单文案；名称保持原文，句子使用插值 |

纯粹内部的 `SupersetLogo` 组件名可在替换图形时改成中性的 `BrandMark`，同步引用。包名、公共类型名、协议字段等不能因为包含 Superset 就跟着改；具体边界见第 8 节。

### 6.3 仓库内其他应用与服务：逐一登记，启用前完成

全仓品牌审计包含下面这些应用。每个入口必须登记为「本分支发布」「尚未发布」或「上游资料」，不能将没有检查的地方直接归为已完成。未发布应用保留在源码中可以保持其上游功能描述，但不能在本分支 README 冒充已交付功能。

| 范围与现有入口 | 本分支启用时必须处理的内容 |
| --- | --- |
| `apps/web/src/app/layout.tsx`、`apps/web/src/app/favicon.ico`、`apps/web/public/favicon-192.png` | 页面标题、登录和页脚、favicon、元数据、反馈链接 |
| `apps/marketing/src/app/[lang]/metadata.ts`、`apps/marketing/src/app/[lang]/components/Header/components/SupersetLogo/` | 产品名、Header/Footer、SEO、Open Graph、canonical、下载与功能宣传 |
| `apps/marketing/public/` | favicon、touch icon、`og-image.png`、`media/superset-app-icon.png`、邮件品牌资源、当前宣传截图 |
| `apps/docs/src/lib/layout.shared.tsx`、`source.ts`、`docs-mcp-server.ts`、`apps/docs/public/` | 文档 Header、图形、搜索/MCP 名称、正文来源 URL、OG、站点地图、llms 入口；上游内容注明来源 |
| `apps/admin/src/app/layout.tsx`、`apps/admin/public/` | 内部控制台名称和图标；不把上游公司仪表盘当本分支运营界面 |
| `apps/api/src/app/favicon.ico`、`apps/api/src/lib/oauth-metadata.ts`、`agent-auth-metadata.ts` | API/OAuth 客户端展示名称、帮助链接；端点、issuer 与实际服务身份不能随名称虚构 |
| `apps/mobile/app.config.ts`、`apps/mobile/assets/` | 展示名、图标、splash、权限提示；EAS project、OTA、App Group、Apple Team、bundle ID 另行建立维护者身份，不能沿用上游发布基础设施 |
| `packages/email/src/components/layout/`、`packages/email/src/emails/` | 邮件 Logo、主题、按钮、签名、发信与退订归属；上游公司的地址和身份不得直接改写为维护者地址 |
| `apps/discord-triage/src/branding.ts` | Bot 名、footer、图形与社区归属；只在本分支自己的 Bot 中启用，文档编写不触发外部修改 |
| `packages/cli/`、`packages/mcp/`、`packages/sdk/` | 帮助、描述、服务端展示名与 README；实际命令、包命名和协议保持兼容，上游 SDK 的服务归属保留 |
| `packages/agent-setup/`、`packages/mcp/src/` | 检查智能体看到的产品介绍、工具说明、hook 提示与反馈归属；功能名称及已安装脚本的命令保持兼容 |
| `plugins/`、`.agent-marketplace.json` | 检查产品描述及维护者来源；保留第三方插件作者与原仓库，不手改生成的插件清单 |

公司 Logo、模型供应商、集成服务、用户项目 favicon、第三方图片均不是本产品品牌。它们不能被批量替换。

## 7. 品牌配置与实现组织

建议新增以下文件，均为待实施内容：

- `packages/shared/src/product-brand.json`：唯一人工维护的产品字段，包含名称、slug、产物前缀、本分支及上游链接；不放密码、签名密钥、环境地址或版本号。
- `packages/shared/src/product-brand.ts`：无 Electron、env 校验、IPC、网络或数据库依赖的类型化适配层，供主进程、renderer 和其他产品展示代码引用。
- `scripts/print-product-brand.*`：打包脚本读取相同 JSON，按指定字段输出；shell 使用已引用的变量，不能执行品牌字段内容。
- `FORK_NOTICE.md`：人类可读的修改说明，保留原版权与许可证链接。
- `assets/branding/`：Logo 母版与输出规范。
- `docs/design/branding-audit.md`：实施过程中记录现有引用、分类、处理结果及待办。

仓库本身的 package name（如 `@superset/desktop`）保持稳定。builder 的 `extraMetadata.name` 可以表达分发身份，但它必须与运行时品牌、数据目录策略和验收脚本一起修改。source package `productName` 如因工具要求必须存在，作为受校验的派生镜像，不成为第二个任意配置入口。

`COMPANY` 不立即全仓重命名或删除。先盘点每个消费者，将「本产品展示」「Superset 上游资料」「上游账号/服务」分开，迁移产品展示用途，避免官网、账号、服务地址被误改。已有环境变量遵循 `docs/environment-variables.md`，本次优先使用静态配置，不新增整套品牌环境变量。

品牌 JSON 不直接储存翻译后的整句文案。React 使用 Lingui 的 `Trans` / `t` 插值，主进程使用 `msg` 与 `i18n`，产品名作为值注入；修改后更新全部 `SUPPORTED_LOCALES` 对应目录。错误页面遵循现有 provider-free 边界。

## 8. 安装身份与数据兼容

### 8.1 展示标识与技术标识分开

| 可随品牌变更的展示信息 | 此次默认保留的技术合同 |
| --- | --- |
| 窗口、菜单、图形、README、发布标题 | `@superset/*` workspace 包名与现有 import |
| 新分发包的产品名、产物文件名 | CLI `superset` 命令和既有脚本使用方式 |
| 本分支反馈、源码、下载入口 | `.superset` 项目配置、已有环境变量和本机持久化键 |
| 维护者自己的桌面分发身份 | RPC/IPC 字段、header、协议与 schema、公开 SDK 类型 |
| 产品专用内部组件名称 | `~/.superset-direct`、`SupersetDirect` 系统 runtime、远端 launchd 身份及安装协议 |

远端后端的目录、实例 ID、PSK、公钥、签名清单和 schema 都是运行合同。修改客户端品牌不能重写已封存的后端包、跳过签名校验、强制重装后端或导致已有会话失联。若以后要将这些技术名字迁移，单独设计版本化的迁移方案。

### 8.2 第一版品牌切换的默认策略

先保证与官方应用隔离，再保证已有 SSH Preview 用户的数据继续可用。当前 preview 的 appId 是 `com.superset.desktop.ssh-preview`；新分发身份建议改为维护者命名空间，**数据目录不随新产品名自动换掉**。

`direct-app.ts` 在 `app.getPath("userData")/direct-workstation` 下创建连接与操作记录数据库，也将本地 backend 放在其下。Electron 名称变更可能改变默认 `userData`。实施动作必须按以下顺序：

1. 在旧安装包实际运行时记录应用名、package 元数据及 `app.getPath("userData")`，区分预览包、官方包、开发工作区。不要根据产品名称猜测已有目录。
2. 为本分支设置稳定的数据目录标识；第一版沿用经核实的旧 SSH Preview 目录。在 `requestSingleInstanceLock()`、`app.whenReady()` 及任何数据库或本地 backend 初始化之前设置。
3. Dev 环境继续隔离，不能复用已安装预览或官方目录；旧目录识别只匹配已核实的本分支预览身份。
4. 分发改名后无需拷贝 SQLite 数据，避免遗漏 WAL、锁与运行中 supervisor。保留连接、namespace、操作意图、聊天、项目、终端和凭据定位关系。
5. 新旧预览同时运行时共享稳定数据身份，第二个实例应被锁挡住；官方应用仍可独立运行。
6. 文档说明新旧预览包的替换方式；不要在未验证运行状态时自动删除旧 app、用户目录或旧 backend。

如后续一定要换新目录，另行实现停止旧进程、完整备份、幂等复制、验证、失败回退和两处都有数据时的显式选择；不能在本次视觉改名中顺手迁移。

旧 URL scheme 是否仍有使用者需审计。官方 `superset://` 不被本分支接管；旧预览 `superset-ssh-preview://` 只在需要且验证了处理能力时作为兼容别名。不能仅修改平台注册名称而假设深链已支持。

## 9. 打包、下载与更新

| 现有路径 | 必须同步的关联 |
| --- | --- |
| `.github/workflows/release-desktop-preview.yml` | 产物定位、checksum 输入文件名、Release 标题；依赖完成资源校验与完整验收后才上传 |
| `apps/desktop/scripts/verify-preview-dmg.sh` | DMG 内 `.app` 名、可执行文件名、bundle ID；改为读取统一的预期值 |
| `apps/desktop/scripts/verify-preview-package.cjs` | 包内 `productName` / `name` 断言、报告中的应用身份；增加本分支来源与离线许可检查 |
| `apps/desktop/electron-builder.preview.test.ts` | 更新预期身份，继续校验独立身份、两套后端资源与公钥，没有品牌变化豁免 |
| `apps/desktop/scripts/verify-direct-ssh-install.mts` | 保留真实首次安装、启动、认证和重连验收；品牌变化应复用原后端合同 |
| `apps/desktop/direct-publisher.ts` | 保持本分支仓库归属，不与 UI 名称混为一个配置 |
| `.github/workflows/release-desktop.yml`、`release-desktop-canary.yml`、`build-desktop.yml` | 登记本分支是否使用，启用时同步产物、渠道和发布仓库 |
| `docs/releases/ssh-desktop-preview.md` | 今后发布的用户说明使用新品牌和修改版声明；实际已验证功能、架构和下载方式单独注明 |

新增本分支来源与许可资源的打包规则，并检查 DMG 中真实文件可读，不只检查源码中存在文件。包内关于页面必须能离线打开完整许可。

当前 preview builder 是 `publish: null`，主入口也没有接入旧 updater。这次默认保持手动下载升级，不增加自动更新功能。旧 `auto-updater.ts` 的上游 feed 登记为待替换/受限入口；本分支以后如启用它，必须先使用本分支渠道并验证升级包身份，防止更新成官方包。

如本分支实际分发 Linux 或 Windows，继续检查 Linux `.desktop` 的展示名、`executableName`、`StartupWMClass`、动作中的 `Exec`，以及 Windows 安装器名称、快捷方式和应用图标。桌面启动器可采用新分发名称，但必须整组一致；这不等于把兼容 CLI 命令 `superset` 一并改名。尚未分发的平台不能在 README 中写成品牌改造已验证。

产物文件名可以改新品牌，但版本仍遵循已有桌面/CLI/backend 的统一版本检查。不为了品牌变更单独调一个组件版本。旧 Release、tag、下载附件、SHA256、SOURCE 和 SSH 验收报告保持原样；新的名字从新构建开始生效，不给旧构建补写新身份。

`ssh-preview-v<version>` 这类技术渠道 tag 可保留，Release 展示标题改新产品名。不要因名称变化把 prerelease 自动变成 stable。README 只链接实际发布或已验证的附件，文档不得声称尚未生成的新包可下载。

## 10. README 与仓库说明

### 10.1 首页结构

根 `README.md` 改为本分支的真实首页，建议按以下顺序组织：

1. 新 Logo、唯一产品名。
2. 显著来源说明，紧接名称：`基于 Superset 的非官方修改版，保留原项目版权与 Elastic License 2.0。`
3. 本分支已提供的改动：本地工作台、SSH 直连、缺失后端的验证与自动安装等。用本次实施时的实际验收记录确认功能状态。
4. 本分支下载、支持平台、首次安装与升级说明。macOS 两种架构按验证结果列出，不能照抄上游 Linux/手机/云服务宣传。
5. 使用截图与简短上手步骤。新截图来自本分支真实运行；保留原截图时明确标「上游界面示例」。
6. 本分支构建、开发与验证说明；现有命令是否适用于当前无账号入口需确认。
7. 来源与差异：上游仓库、相关文档、分支功能边界。
8. 本分支贡献、反馈入口，以及上游贡献者致谢。
9. 原许可证、版权与修改说明链接。

首页示例只使用工作名：

```markdown
# Superset Remix

基于 [Superset](https://github.com/superset-sh/superset) 的非官方修改版。
本分支独立维护，保留原项目版权与 [Elastic License 2.0](LICENSE.md)。

[下载本分支版本](https://github.com/4444zyf/superset/releases) ·
[反馈本分支问题](https://github.com/4444zyf/superset/issues) ·
[来源与修改说明](FORK_NOTICE.md)
```

### 10.2 其他仓库入口

| 路径或入口 | 执行动作 |
| --- | --- |
| `readme/README.*.md` | 每一种现有语言的开头同步产品名、修改版说明和本分支下载/反馈；迁移正文中的误导入口与未交付宣传。相对链接正确指向 `../LICENSE.md` 等 |
| `CONTRIBUTING.md`、`DEVELOPMENT.md` | 说明向本分支还是上游贡献，保留原贡献规则的来源；开发步骤以本分支当前入口为准 |
| `SECURITY.md` | 分开本分支与上游漏洞报告；核实本分支私密报告入口后才公布，不将本分支安全支持指向上游邮箱，不继承上游三工作日响应承诺 |
| `CODE_OF_CONDUCT.md` | 保留原规范与署名；核实维护者联系渠道，不能批量替换作者身份 |
| `AGENTS.md`、应用/包内 `AGENTS.md` | 增加产品身份与兼容名字规则，保留 monorepo 路径、命令和技术名称；不因品牌词替换改变开发约束 |
| 根及应用 `package.json` | description、repository、homepage 等按真实归属更新；包名与原 author 归属分开处理 |
| `.github/ISSUE_TEMPLATE/config.yml`、`bug_report.yml`、`feature_request.yml` | 问题、帮助与文档入口指向本分支；引用官方文档时注明上游 |
| `.github/pull_request_template.md` | 说明本分支改动与验证要求，避免误导贡献者向官方提交流程 |
| `.github/templates/`、`.github/prompts/` | 检查自动生成的预览、截图、发布文案及反馈归属 |
| 各应用/包的 README、`docs/` 和开发 runbook | 当前操作说明使用本分支身份；协议、上游资料、过去的证据按其实际身份保留 |
| stars、release、社区徽章 | 本分支统计使用本分支；上游统计仅作为标明来源的致谢，不伪装成本分支数据 |
| GitHub About、topics、social preview、固定链接 | 发布前列为仓库设置任务；使用新名称、修改版描述和新图形，明确实际需要的设置权限 |

上游团队介绍、公司地址、客户列表、官方服务承诺不能改成「我们的团队/客户」。可将有来源价值的内容放入上游致谢或历史资料，并保留其原身份。

## 11. 全仓审计方法

首先执行只读搜索；下面命令用于发现引用，不代表所有结果都应替换：

```bash
rg -n --hidden -i \
  'superset|com\.superset|sh\.superset|superset-sh/superset|superset\.sh' \
  apps packages plugins .github scripts docs readme \
  README.md AGENTS.md CONTRIBUTING.md DEVELOPMENT.md SECURITY.md CODE_OF_CONDUCT.md package.json \
  -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/release/**' \
  -g '!**/.git/**' -g '!**/.env*' -g '!**/*.map' -g '!**/routeTree.gen.ts'

rg --files apps packages .github scripts readme docs |
  rg -i 'logo|wordmark|brand|favicon|apple-touch|splash|icon|manifest|readme|metadata'
```

文本搜索不能识别 PNG、ICNS、ICO、TIFF、截图、视频里嵌入的名称。按资源用途逐个查看当前分发和首页媒体，记录它们是产品资源、上游历史还是第三方素材。

`branding-audit.md` 至少记录：路径、具体引用、是否可达/分发、用途类别、处理动作、执行状态和验证证据。分类采用：

| 类别 | 规则 |
| --- | --- |
| 本产品展示 | 改新品牌，包括 alt、aria-label、tooltip、通知、错误和邮件标题 |
| 本分支维护入口 | 改成本分支真实源码/下载/反馈入口 |
| 上游来源与声明 | 保留原名、版权、许可和作者，必要时补来源标签 |
| 上游服务或兼容入口 | 保留实际上游身份，不能让名称改写暗示服务已迁移 |
| 技术合同 | 保持兼容；需要迁移的项目另开方案 |
| 历史证据 | 保留原值、原文件名、摘要、截图和日期 |
| 第三方与用户内容 | 保留，不纳入本产品 Logo 替换 |

未分类的命中项不能直接忽略。最终标准不是仓库中零次出现 `Superset`，而是没有仍被当成本分支当前身份展示的旧品牌，且所有保留项有可解释的用途。新增自动审计只针对本次分发与公开入口，使用具体路径/规则，不用宽泛目录排除遮住问题。

## 12. 执行顺序与交付物

| 阶段 | 工作 | 完成条件 |
| --- | --- | --- |
| A：品牌基线与盘点 | 确定名称/slug；建立字段配置和全仓引用分类；确认发布面与旧数据实际路径 | 名称一次确定；所有引用类别有规则；不依赖虚构网站或服务 |
| B：视觉资源 | 绘制统一几何 Logo、单色和应用版本，输出平台资源与母版说明 | 16/24/32/128/1024 px 可辨认；安装包与侧栏一致；无副标题 |
| C：当前应用 | 更新工作台、标题、失败页面、关于、来源标识、可访问名称、固定链接与翻译 | 主入口真实显示新品牌；来源可见；离线关于可读；不破坏错误恢复 |
| D：分发身份 | 稳定数据目录；同步 builder、CI、验收脚本、资源和许可 | 旧预览升级不丢数据；与官方隔离；包内身份/产物/验收一致 |
| E：仓库与其他展示 | 重写根 README、全部语言 README、贡献/安全/模板；逐个处理其他应用登记项 | 所有公开说明归属清楚；未发布功能不宣传为可用 |
| F：验证与发布准备 | 截图、包内检查、升级兼容和完整 SSH 验收；更新本次发布说明 | 第 13 节全部适用项有证据；尚未启用项明确记账，不伪报完成 |

建议按「品牌数据与资源」「当前应用与兼容」「仓库说明与关联发布」分批提交，便于复查。多个提交仍属于同一设计目标，必须在分发前共同完成。对本分支以后启用的网站、移动端和服务，执行第 6.3 节对应准入清单。

未定的最终名称只影响 A 阶段的字段落定；引用分类、数据路径盘点和文档结构可以先做。官网、客服或移动端独立发布身份没有真实配置时，不阻塞当前桌面与仓库改造，也不能假设这些配置已存在。

## 13. 验收与回退

### 13.1 视觉和来源

- [ ] 首次看 README、DMG 和主界面，均能看出是 Superset 的非官方修改版。
- [ ] 只有一个产品名；没有额外产品副标题。关于与来源说明不被包装成第二个产品名。
- [ ] 侧栏、窗口、Dock/菜单栏、安装图标使用一致的品牌；渠道只表达 Dev/Canary/Preview 状态。
- [ ] 标准窗口和最小支持窗口宽度下，名称、来源标识及按钮无遮挡、不溢出。
- [ ] 当前主界面、错误页、菜单、权限提示、可访问名称和全部已启用语言无漏改的产品旧称。
- [ ] 原版权、上游链接、原许可证、第三方归属和修改说明保留且可读。

### 13.2 链接与仓库

- [ ] 全部 README 的下载/反馈属于本分支；上游文档和社区有明确标签。
- [ ] prerelease 下载没有误用 `/releases/latest`；链接所述架构、版本与真实附件一致。
- [ ] 截图真实对应本分支；历史上游图像与验收记录保留原身份。
- [ ] CONTRIBUTING、SECURITY 和 Issue 模板不承诺上游团队会处理本分支问题。
- [ ] 未发布应用、官方 Pro/手机/云功能及上游客户背书没有被包装成本分支成果。
- [ ] 全仓命中项已分类；每个保留项有理由，每个公开产品入口有处理状态。

### 13.3 兼容与安装

- [ ] 全新安装与旧 SSH Preview 升级分别验证；官方安装目录和用户数据未被读取或覆盖。
- [ ] 改名后旧预览连接列表、选中的 namespace、本地工作区、聊天与操作记录仍可用。
- [ ] 新旧预览不能并发写同一数据目录；开发环境继续与安装包隔离。
- [ ] 已有远端 backend 被复用，实例身份与认证保持稳定；没有因品牌改名重新 bootstrap。
- [ ] 首次安装、launchd 启动、认证 RPC、断开重连和重开客户端继续通过现有完整验收。
- [ ] 原后端签名与公钥校验、资源完整性及统一版本检查继续生效。
- [ ] DMG 挂载后的产品名、可执行文件、appId、图标、许可和来源与配置一致。
- [ ] 如果提供更新功能，其 feed 和产物属于本分支；默认手动更新不偷偷启用上游 updater。

### 13.4 检查方式

文档和图形调整使用链接、路径与视觉检查，不为常量替换新增大量快照测试。对数据目录、外部链接和发布归属这种实际行为变更增加小而明确的回归测试，并更新现有安装包身份验收。

实施代码后的基础检查示例：

```bash
bun run check:versions
bun run check:i18n
bun test apps/desktop/electron-builder.preview.test.ts
```

按改动范围执行桌面/shared 类型检查及 scoped lint，避免为本次品牌修改跑会生成大量无关文件的命令。真实 UI 截图按 `.agents/skills/cdp-verification/SKILL.md` 验证正确的当前工作台入口，不能用静态 HTML 或修改 DOM 代替。DMG 与首次安装验收继续由现有原生 Mac 工作流运行；记录提交、版本、架构、截图、检查输出及失败情况，未运行的检查明确标记。

回退默认只回退展示与分发配置，不删除任何用户数据、不改远端后端、不开数据库降级。发布前验证旧预览仍能读取沿用的数据目录；新构建失败就停止提供新包，不能通过放松签名、身份或完整性校验让包通过。
