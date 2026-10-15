# Superset 无账号功能对齐

2026-10-14。版本 1.37.7，分支 `release-local-ssh-feature-parity-1.37.7`，基于已验证 1.37.6 的 `0ad8c05dd`。目标：原有功能逐项保留、复用并验证；能够在本地或 SSH 上运行的功能补齐数据源，而不是因为原页面位于 `_authenticated` 下就排除。

## 验收原则

每项分别记录源代码保留、当前界面接入、行为测试、真实运行证据。未接入不算完成，mock/组件测试不代替实际后端、实际用户输入和发行物验收。先增加失败测试，再实现，再运行回归；TDD 的红/绿日志独立记录。

优先使用原版组件与 host-service API。依赖云端 provider 的组件提取可复用展示部分，原 wrapper 保持原合同；新 wrapper 接本地/SSH，不模拟 Superset 登录。现有 tRPC 输入、输出、错误与传输保持兼容，新能力使用可选版本标志，旧后端在操作前禁用并解释原因。副作用只由明确用户操作触发，连接/恢复不会自动提交、运行脚本、安装插件或创建第二个 Agent。

## 基线清单

这是工作清单，`待接入`不是实现完成。细分操作的实际覆盖随实现逐项补充。

| 功能组 | 原版实现或数据源 | 1.37.6 当前入口 | 对齐要求 |
| --- | --- | --- | --- |
| 工作区标签、标题、重排和关闭 | `@superset/panes` | 已接入 | 保留归属、关闭不停止任务 |
| 分屏、焦点、拖拽、比例、窗格菜单 | `@superset/panes` | 已接入 | 使用原引擎，完整布局恢复 |
| 侧栏分组、固定、搜索和排序 | 原 sidebar/workspace stores、tagFolders | 部分 | 目标端元数据与本地视图分别存储 |
| 项目导入、创建、克隆、打开 | project/workspaceCreation | 部分 | 所选机器执行，不误用本机路径 |
| Git worktree、分支与工作区归档/删除 | workspaces/workspaceCleanup | 部分 | 原生命周期与脚本，先展示删除影响 |
| 项目设置、颜色、命名、稀疏检出 | project/settings | 待接入 | 复用表单，使用所选后端 |
| 项目 setup/run/teardown 脚本 | config、runtime/setup | 待接入 | 明确运行、原终端显示输出 |
| 终端渲染、搜索、图像、Unicode、剪贴板 | 原 terminal surface/Search | 已接入核心 | 接齐主题、字体、链接与全部设置 |
| Agent 终端预设、自定义命令 | 原 presets/agent configs | 待完整接入 | 原预设与命令构造，保留权限设置 |
| 终端链接、文件定位、通知与退出行为 | 原 terminal helpers/notifications | 部分 | 路径在运行机器上解析 |
| 文件树、展开、隐藏文件与多文件 | 原 FilesTab/FilesView | 部分 | 原交互，目标端目录数据 |
| 文件新建、文件夹、移动、重命名、复制、删除 | filesystem | 待接入 | 原服务、冲突不覆盖、删除确认 |
| 文件/内容搜索、快速打开与跳转 | filesystem.searchFiles/searchContent | 待接入 | 有界结果、晚回复与工作区切换隔离 |
| 文本编辑、语法、查找、折叠、保存 | 原 CodeEditorSurface | 已接入核心 | 多文件草稿、主题/字体/缩进设置 |
| 图片、Markdown、二进制与 Diff 预览 | 原 FilePane registry/views | 部分 | 复用原展示组件，保留只读边界 |
| Git 状态与工作区差异 | git.getStatus/getDiff | 已接入 | 原版 diff 与变更列表 |
| Git 暂存、撤销暂存、提交 | git.stage*/unstage*/commit | 待接入 | 复用 StageToggleButton/CommitForm，仅明确选中范围 |
| Git 历史、分支、基础分支、同步 | git.listCommits/listBranches/push 等 | 待接入 | 原操作，远端自身 Git 凭据，不依赖 Superset 账号 |
| GitHub PR、检查、评审与 Issue | github/pullRequests/issues | 待接入 | 使用所选机器已有 GitHub 登录；没有登录显示真实原因 |
| 聊天会话、流、Markdown、附件、审批 | chat-runtime、chat-ui、attachments | 部分 | 原协议与展示，真实模型验证单独记录 |
| Agent 原生输入、候选命令、提及、模式/模型 | PromptInput、ACP | 待接入 | 按 `ssh-agent-native-input.md`，保留 TUI |
| Agent 配置、技能、MCP 与工具配置 | settings.agentConfigs、agentTooling | 待接入 | 本地/SSH 配置，托管 MCP 不伪装为可用 |
| 插件清单、安装、更新与移除 | plugins/installed_plugins.json、原插件界面 | 待接入 | 同一声明式状态，目标机器执行 |
| 端口发现、转发、浏览器打开 | ports、已有 direct forwarding | 部分 | 手动控制，关闭客户端不自动重放 |
| 内嵌浏览器、导航、历史、开发工具 | 原 BrowserPane、browser router | 待接入 | 本机浏览器与远端页面的明确传输边界 |
| 浏览器设置、数据导入与隔离 | 原 BrowserSettings | 待接入 | 原权限与用户选择，不隐式读取其他浏览器 |
| 命令面板、全局快捷键与导航 | 原 commandPalette/hotkeys | 待接入 | 原注册表、设置与当前操作实际对应 |
| 外观、语言、主题、字体 | AppearanceSettings、i18n/themes | 部分 | 原设置与组件真正响应 |
| 文件、终端、Git、行为设置 | 原 settings 各页 | 待接入 | 原语义，有界本机 SQLite 偏好 |
| 铃声、通知、连接和链接设置 | 原 settings/notifications | 待接入 | 复用原行为与 OS 权限 |
| 实验性选项与权限设置 | 原 Experimental/PermissionsSettings | 待接入 | 默认值、权限和实际能力一致 |
| Agent 自有登录与本地用量 | usage/agent accounts | 待接入 | 区分第三方 Agent 登录与 Superset 登录 |
| 页面/笔记与本地文件关联 | 原 Pages UI、filesystem | 待分析接入 | 可本地保存的内容补齐数据源 |
| 任务/看板与第三方 Issue 关联 | 原 Tasks UI、issues | 待分析接入 | 可本地保存的任务补齐元数据，不冒充云同步 |
| 自动化与运行记录 | 原 Automations UI、host runtime | 待分析接入 | 本地/SSH 调度、可审查命令和真实生命周期 |
| 窗口、菜单、托盘、恢复、手动更新 | 原 main helpers/direct restore | 部分 | 保留原执行，不接官方更新 feed |
| Superset 登录、组织成员、计费、官方云主机 | 仅 Superset 账号/服务 | 明确排除 | 删除仅服务此范围的多余代码；共享实现先提取，不提供假数据或假登录 |

网页和移动端发行不在此桌面功能验收内。第三方 Agent/GitHub 登录不等于 Superset 账号体系，不以缺少当前测试凭据为理由删除功能；可以实现可审查结果并明确标注实际认证验证的缺口。

## 1.37.7 当前进度（2026-10-15）

上表保留1.37.6基线，用于逐项核对；当前完成情况按实际接入范围记录如下。整组中的细项未完成时，不将该组标为全部完成。

| 功能组 | 已接入并有真实Linux/SSH窗口证据 | 仍需补齐 |
| --- | --- | --- |
| 文件 | 原文件树/编辑器/多标签、文件操作、内容搜索、草稿、自动保存 | 全量文件监听、预览、内联操作、拖拽、快捷键、全局退出草稿提醒等 |
| Git | 暂存/撤销暂存/仅暂存提交、身份配置、原Diff、提交历史、基础分支、分支重命名与推送、原菜单Fetch/Pull/Sync（第31轮实际窗口通过） | Fetch & Pull实际窗口验证、分支其他操作、完整PR/检查/评审接入等 |
| 设置 | 原主题/字体/语言控件及自动保存、终端选中复制 | 其余文件/终端/Git/行为/权限设置及快捷键 |
| 布局与终端 | 原工作区标签、分屏、核心终端与恢复 | 全部原侧栏元数据、项目生命周期与终端周边入口 |
| 账号代码清理 | 删除两处旧侧栏付款失败卡片；启动链含别名/导出/lazy import的无账号审计通过 | 旧账号页面、旧启动、Paywall及不再使用的依赖 |

实际证据、失败记录和组件/后端回归分开记于[实施报告](../implementation/local-ssh-feature-parity-2026-10-14.md)。1.37.7尚无macOS安装包验收，Linux源码窗口不代替发行物验收；其余原版能力仍按清单继续实施。

## 当前实施顺序

先补文件/Git 端到端，再接设置/快捷键与项目生命周期，随后 Agent/插件/浏览器及本地元数据功能。每阶段更新实现报告中的红绿测试和实际证据；最终逐项清单不能存在未说明的入口缺失。

## 账号专属代码清理

用户于2026-10-15明确允许删除相关账号体系的多余代码。Superset登录、组织成员、计费与官方云连接的专属代码不再有保留要求；按依赖逐批移除，并清理对应入口、生成路由及无用依赖。`_authenticated`目录位置不能作为删除依据，其中仍有工作站复用的编辑器、文件树、Git和设置实现。先保留或提取共享实现、补齐本地/SSH数据源，再删除专属wrapper。第三方GitHub/Agent登录、SSH凭据、后端令牌和权限校验继续保留。当前检查未代表整条旧账号代码链已经清理完成。

首批清理：删除旧v1/v2工作区侧栏的付款失败卡片hook及导出、调用与候选项；它只访问Superset订阅/组织/发票并跳转官方计费，不承担本地或SSH能力。共享SidebarCardSlot、项目setup提示与其余原版组件继续保留。该hook没有持久化键，不涉及旧数据迁移或删除。其他账号专属页面、主进程旧启动和依赖清理仍在清单内。
