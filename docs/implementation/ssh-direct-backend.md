# SSH 直连后端：实现与验收记录

日期：2026-10-10。需求与完整验收契约见[设计文档](../design/ssh-direct-backend.md)，原 `main` 的已有行为见[现状文档](../current-state-accounts-remote-sessions.md)。本文记录后续获授权的实现，不把新增能力写回原源码现状。

## 基础阶段

基础版本 `58284bc64` 已提交并推送到 `origin/work`。桌面与离线导入整合随后提交为 `ba6c39a18`；终端清理的系统 session 隔离修复为 `d89278ab7`，均已推送。以下为各组件的实现路径：

| 组件 | 实现 |
| --- | --- |
| `packages/host-service/src/direct/` | 独立 direct entry/config；PSK、随机持久身份、独立数据目录；不构造 Superset 云 API/relay/JWT；操作记录、维护冻结、独立 supervisor、显式停止。 |
| `packages/chat-runtime/` | 可选持久命令去重；相同 ID/输入只接受一次，重启后可查；不自动重放已接受的 prompt。 |
| `packages/direct-connection/` | SQLite 连接登记；身份及 generation 校验；系统 OpenSSH/SFTP；私有 ControlMaster/Unix socket；本机 detached 后端及独立代理；HTTP/WS、开发端口转发。 |
| `packages/direct-install/` | Ed25519 发行校验、完整性与权限检查、非 root 服务身份、launchd 安装/控制、容量预检、不可变发行目录、持久激活与备份/回滚、停用和受控修复。 |
| `packages/cli/scripts/build-direct.ts` | 双架构目标的完整后端打包入口；要求对应 Mac 构建 worker，核对固定 Node/ABI/最低系统版本与原生 smoke 后签名。 |

新传输路径为 `A main → A 自有 loopback listener → SSH streamlocal → B 用户私有 Unix socket`。凭据保留在主进程；缺少私有 socket 不回退到 TCP。socket 使用短路径摘要，避免 macOS AF_UNIX 路径长度限制。本机路径也通过 main 自有代理连接私有 socket，关闭代理不停止后端。

普通关闭、断开和移除连接只收回 A 的代理/SSH/订阅。后端由独立 supervisor 持有；显式 Stop 使用持久 disabled 标记，避免 supervisor 立即复活。安装新 release 与激活分开；自动激活只允许协议、数据迁移、Node ABI、目标平台和 PTY bundle 兼容的候选，不支持的停机升级会明确拒绝。

## TDD 与独立审查

以下是实际发现并完成红转绿的回归，完整测试与相应代码同目录保存：

[独立审查记录](ssh-direct-adversarial-review.md)区分已修复问题、仍在调查的运行故障和真实 Mac 尚缺的条件。安装安全修订 `a6b6f95b2` 已提交并推送；其安装器 66 项、builder 4 项合计 70 项通过、167 次断言，两个 package 的类型检查和 2 项真实 Node SQLite 测试通过。incoming/reader 的独立 15 项复核通过，超限时先清理本次 producer 子树再释锁。

| 发现 | 修复与证据 |
| --- | --- |
| B 停止后其他 UID 可抢占旧 TCP 端口，取得后续 PSK | 所有新增秘密消费路径改 Unix socket；manager 缺失/错误路径拒绝与 streamlocal 参数 6 项回归；本机 HTTP/代理测试证明恶意 TCP listener 收到 0 请求。 |
| A 被 SIGKILL 后留下 SSH listener | 独立 parent watchdog；真实 Node 的父进程强杀、子进程忽略 TERM、SSH 自退出时清理 proxy 三项回归通过；真实 OpenSSH string target + SIGKILL 组合验证 B 同一 PID 仍响应。 |
| 断开/修改连接时，旧 RPC body 或迟到本机代理仍可返回 | body 解码后再次校验 generation；迟到资源独立关闭；每个本机调用者各有代理，取消旧调用不关闭新连接。 |
| 仅修改连接名称会丢失已校验身份 | 名称不改变目的地址指纹；保留 backend/namespace/UID pins，改变目的地址才清除旧绑定。 |
| drain/frozen 阶段仍能启动终端或后台写入 | mutation/原始终端入口统一维护边界；SQL 原子冻结；统计 PR 后台工作，冻结后迟到回调不继续写。 |
| 激活中 A 断开、健康失败或提交响应丢失 | 持久阶段 journal + resident supervisor 推进；可回滚阶段恢复一致性备份；已提交响应丢失不恢复旧数据覆盖新写入。 |
| 本机 supervisor 误调用 Mac root-release 激活工具 | 明确 local/managed installationMode；本机不走系统发行目录校验或 Mac 激活流程。 |
| direct 启动时校验云环境/读取旧账号配置 | 独立启动入口、懒加载 legacy cloud 功能；direct vendor profile 和账号解析隔离。 |
| 已提交的旧激活清理后来上传的候选 | 发布、控制和消费共用 namespace 安装锁；只消费当前事务对应的 release 标记。 |
| 私有配置或身份被换成 FIFO 后阻塞 | 私有配置 reader 使用 O_NOFOLLOW/O_NONBLOCK 并检查 owner、普通文件及长度；真实 Node FIFO 回归先红后绿。上传 payload 另由 UID 子进程限长读取，bootstrap 用系统 Bash 管理截止与子树清理，manifest reader 使用 30 秒截止与 SIGKILL；普通 UID FIFO 回归通过，sudo/Mac 尚未执行。 |
| shell PATH 别名绕过 direct CLI 隔离 | 校验 realpath 指向实际可执行文件；异步 login-shell env 合并后再次固定 provider profile、清理旧 token/wrapper。 |
| 完整桌面打包后本机后端找不到 PTY daemon | 从已配置的 host-service 入口定位 sibling bundle；拆开 supervisor 的纯导出与 CLI serve 入口；真实 Electron 本机 session/PTY 验证通过。 |
| 备份失败的目录不计入回收、挤掉最后完整快照 | 创建目录时即记录 building 状态；回收区分完整与未完成快照并保留最后完整备份；真实 SQLite/WAL 与恢复两项 Node 回归通过。 |
| 离线导入回滚第二次中断后误删已恢复的原目录 | hadOriginal 与 rolling-back 阶段先持久化，恢复目录 fsync 后才完成 journal；歧义或回滚失败保留锁，针对性恢复回归与独立复现通过。 |
| v1 已关闭 pane 的 provider capture 遗漏、原 metadata 带入旧可执行配置 | 按唯一历史归属保留白名单 capture，重复归属整次拒绝；metadata 只投影静态字段，不创建活终端。13 项 mapper 测试和独立 capture fixture 通过。 |
| 本机自动重连在 endpoint 消失后启动 supervisor | 本机不登记自动重连；实际 LocalBackend/Unix fixture 的 supervisor spawn 从两次降为一次，SSH 有限重试保留。 |
| incoming 容量检查退出后，文件扫描仍继续或留下后代 | 本次私有 FIFO/completion/ack 将扫描 wrapper 保持到清理结束；超限先停止并回收自有子树，再删除本次 helper 和释放 admission 锁，真实 producer/sleep 回归通过。 |
| 清理同名 TTY 时选中另一系统 session 的任务 | TTY 扩展同时要求 root 的已知系统 session 匹配；Linux 使用 sid，Darwin 按 Apple 源码使用 opaque sess。独立 8 项回归通过，3 项真实 Node 同 session 孤儿/重新快照/TTY straggler 测试通过。未知 session 禁用 TTY 扩展，保留 PPID 树与已知 PGID。 |

截至基础阶段已实际执行：direct-connection 47 项 Bun 测试及类型检查；SSH watchdog 3 项真实 Node 测试；host 端口 18 项真实 Node 测试；direct/PR 77 项定向测试；chat-runtime 241 通过、2 项供应商 live 测试跳过；terminal Node 50 通过、2 跳过；shared/chat/host 类型检查；最新 host bundle 构建。安装器及 builder 50 项测试通过，并完成类型和 scoped Biome 检查。计数是各自命令的结果，不汇总为一个重复计算的总数。

## 桌面整合阶段

默认 Electron main/preload/renderer 改为无账号工作台；旧云入口保留为未加载的 legacy 模块。main 持有秘密、登记身份和 durable intents，renderer 只持 secretless descriptor。已接入 SSH 与固定本机连接、项目/session、xterm、chat capability、文件/Git/附件、workspace 端口与显式 Start/Stop。SSH 传输中断自动重连最多三次，只重建 A 的传输、读状态和 attach；不安装或重启 B，不重放创建/启动/prompt。本机故障需要显式 Connect/Start，避免自动连接意外启动本机后端。新旧 generation 和用户取消均有回归。

源码 `ba6c39a18` 的桌面完整构建和 full typecheck 通过；定向 70 项测试通过、288 次断言，包含真实编译 Lingui 的 Router 故障 fixture，另有 18 项 catalog/activation 检查通过。新增工作台纳入 i18n enforced directories，58 项扫描通过；17 个 locale、6,395 条消息严格编译通过。同时执行全构建和类型检查时，已有 compiled fixture 曾超过默认 5 秒；构建结束后按原命令顺序运行通过，未调整 deadline、断言或源码。

终端隔离修复后的完整 Desktop build 与 full typecheck 再次通过，69 个 JS/CSS/HTML 文件的 SHA256 manifest 指纹为 `bb243484f1e335d762afdeb26648754453dbc5197444b93105ddd8167fd79c0e`。它包含安装器读取截止、v1/v2 导入、仅 SSH 自动重连与 session 隔离；这不是 Darwin 签名或原生依赖验收证明。远端长期任务的 B fixture 保留旧 bundle，不能将复连解释为远端已升级最新发行物。上一产物 `b7969603a2f78245d160320bb65f074a3928b268c05f60c581e6521ab3b303da` 的最终冒烟发现了下述 Stop 故障，不能把此前存活证据直接延伸到该故障之后。

## 离线旧数据导入

本机连接提供原生目录选择与明确确认，单次导入一份旧 v2 namespace，或一份包含 `local.db` 的 v1 home。先显式 Stop；目标必须资源为空，导入完成仍保持 disabled，不自动 Start。源数据库/WAL、app-state 和终端历史先复制为快照，实际源文件字节不变；活跃进程、打开的源文件、身份/路径冲突或不支持的布局均拒绝整次导入。导入锁阻止并发 Start；持久 journal、目录 fsync 和回滚记录保护中断恢复，恢复失败保留锁供处理。

保留可证明的项目、工作区、终端及 provider session UUID/路径。v2 可保留本地 chat journal，恢复为离线状态，待发送 prompt 和审批不会执行；v1 没有可导入的 chat journal。缺失的 actor 保持 NULL 并给出警告，不猜测云账号。旧账号、token、hooks、MCP 与可执行设置不迁移。v1 scrollback 保存为静态 `legacy-history`，metadata 仅保存白名单字段；已关闭 pane 的 provider capture 也可保留，未伪造活终端。当前没有专用静态历史回放界面，也不复制 vendor transcript/profile，因此 session ID 留存不保证新隔离 profile 能继续供应商会话。

这一步没有自动扫描多份旧 namespace 或跨来源合并。真实 Linux 普通 UID、Node 原生 SQLite 与系统 lsof 已验证 v1/v2 文件不变、活跃 source 拒绝、非空 target 拒绝及导入后停用；Electron 原生选择器与确认流程也已实际验证两种来源，显式 Start 后可选择导入的项目和工作区。

## 实际运行证据与边界

基础 checkpoint 后的候选标记竞争、FIFO 阻塞、UID 子进程截止、PATH 别名与 builder import smoke 问题均已修复并通过独立复验。安全 checkpoint `07076caf2` 的安装器和 builder 54 项测试通过，真实 Node SQLite 两项通过；后续本机 FIFO 的一项真实 Node 回归通过。最新 direct-connection 全部 52 项 Bun 测试、类型检查、1 项真实 Node FIFO 与 3 项真实 SSH process/watchdog 测试通过；完整 importer/mapper/startup-lock 34 项通过、132 次断言，host 类型检查通过。导入夹具的 Bun SQLite 默认延迟关闭曾导致 WAL 后续清理触发指纹拒绝，已用确定性回归定位并改夹具 `close(true)`，生产指纹检查不变。新增 Node suites 已注册为 Turbo task，并与 Bun tests 一起进入 CI。阶段提交不是发布验收通过。daemon `auto-update defers when live sessions exist` 的失败已使用未改基线复现，基线允许 live fd-handoff 的实现与旧测试期望不一致；完整 daemon suite 不记为通过。此前完整 host suite 还有 `/home/agent` 只读造成的 EROFS 失败，不能列作全套绿色。

Linux cloud 采用隔离的普通 UID 后端、真实 OpenSSH sshd、真实 PTY、Electron 与 CDP，未操作用户机器。现有证据目录为 `/workspace/.cloud-onboarding/superset/runtime-verification/`；本机进程退出/复连的检查记录在 `/tmp/superset-local-unix-persistence-check.json`。

11:15:04 UTC，上一产物只对 fresh import-v2 namespace 执行 Stop 时，另一组本机和远端的无限 PTY 心跳任务同时退出；两组旧后端和 daemon 仍在，远端 HTTP 任务仍在。新命令 127058 早已执行完毕，Stop 实际清理其仍在的 PTY shell；现场未保存该 shell 的坐标。旧任务 PID 79596/72994 成为 PID1 下的 zombie，`/proc` exit 字段为 0；真实自有孤儿遭 SIGKILL 也得到该值，故不能由它推断退出原因。原始观察已保留为 `final-source-stop-anomaly.json`，这次未记录信号的事件仍不能确定完整因果。

调查确认不同 devpts 挂载共享 PID 视图、TTY 都可能同名。确定 TTY slot 的真实旧/新对照中，主 close 的 pts/1 与旧 HTTP 同名、SID 不同；旧 collector 尝试向 HTTP shell/task 的 PID/PGID 发四次 SIGKILL。随后 padding PTY 的 pts/0 清理又尝试向新本机/远端测试任务发八次，均被私有信号拦截器拒绝。修复版两次清理的外部信号请求为零，自有 hung shell 正常关闭。旧/新各有 2/1 次 absent-pid 的合成 ESRCH，另行计数；不把它们叫作全部阻断为零，也不把拦截保住旧任务叫作旧产品通过。

`d89278ab7` 限制 TTY 扩展必须在同一系统 session。该修订的 PTY Bun suite 为 191 pass、5,896 次断言，PTY 与 host 类型检查通过，真实 Node kill-tree 3/3 通过。完整 PTY Node suite 为 51 pass、7 fail；私有基线只跑了三个失败文件，35/42 通过，不冒称完整套件等价。四项普通 I/O timeout 在旧源也复现：instant-exit、multi-byte UTF-8、two subscribers、post-exit ENOENT。detached-helper 使用 kill(pid,0) 将不再运行的 zombie 视为活跃；byte-fidelity 的 after-test ECONNRESET 和 handoff 的等待失败也在受保护基线出现，但拦截影响了 kill 路径，不能确认全部归因。相关日志与限制已保留，未提高 timeout、重试或跳过断言，整套不列绿色。

修复后的真实 GUI Stop 检查中，三组任务均为 `/dev/pts/0`、tty number 34816，SID 分别为 141760/142874/145608，devpts 实例各异。目标 supervisor/backend/daemon/shell/task 均退出，disabled 保留、endpoint 消失；本机 142539 和远端 142880 的 PID/startTicks 不变，心跳分别从 288/265 增至 370/347，原 HTTP 83561 仍以同 PID 响应。七次成功信号只指向目标树，跨目标 namespace 请求及 outside-owned 拦截均为零；另有两次目标已消失的合成 ESRCH。

该检查使用私有产物镜像：main/preload/renderer 字节不变，仅在 supervisor/backend/daemon 三个 helper 原字节前增加测试信号记录与所有权拦截。生产源码和 dist 未改；生产与三个被仪器化 helper 的 hash 均记录。因为 LocalBackend 正常会清理 NODE_OPTIONS，不能以 A 注入成功冒充 backend 已被保护。结果证明此受保护 Linux 检查中未请求外部信号；它不是未注入的物理 Mac 或原生发行包验收，也不补造 11:15 事件的信号记录。

随后用原字节生产 Desktop 产物实际 Ctrl+Q 退出，exit 0；本机 142539 与远端 142880 的心跳分别从 476/453 增至 477/454。新 A 实际 Connect 并在可见终端界面恢复同一 PID，心跳达到 507/474，renderer 错误及该步骤观测请求列表为空。测试心跳程序保留私有记录 preload；不冒称 vendor chat，也没有复活先前退出的 79596/72994。

验收窗口结束后，只清理本次记录过身份的 14 个测试进程。旧 B/Local daemon 仍用旧 bundle，因此绕过旧 JS collector；核对 UID/startTicks/参数后用 PIDfd 固定的正 PID 清理，未用全局进程名或 negative PGID。自有 listener 已关闭，数据和证据保留；容器 PID1 的 zombie 单独记录，不宣称已经回收。云环境 Web/API/Postgres/Redis 未被清理。

旧 `final-reattached-after-reopen.json` 后来被故障后的失败轮覆盖，证据摘要将当前文件明确标为失败；历史 1,051 秒复连观察只按早期记录引用。最新通过证据使用独立的 `stop-isolation/native-quit-and-reopen.json`，避免混用同名文件。清理后再次执行既有 cloud smoke：API 健康、数据库、Web sign-in、development 登录/session 与 authenticated dashboard 全部通过；可复用 install_script/start_skill 已保存。

- `ssh-unix-proof.json`：真实 SSH streamlocal 请求成功；关闭 A 转发后 B 仍响应。
- `orphan-unix-proof.json`：A 被 SIGKILL 后其 SSH listener 消失；B 前后 PID 相同。
- 本机 Unix 链：真实客户端进程退出后 PTY 心跳仍增长，新客户端连接同一 terminal，终端 WS attached；显式 Stop 后数据保留。
- 完整构建的 Electron UI 已验证无账号进入、添加 SSH、远端 session/terminal；强制关闭 A 的 SSH master 后自动重连到同一 PTY，断线期间写入控件禁用；正常关闭 A 后 B 的同一 PTY 心跳继续，重开 A 后连接配置仍在。最新修正的本机入口也已实际创建 session/PTY。远端项目 import 与 workspace 端口已实际操作成功，非 workspace 进程端口被拒绝。原生菜单 File→Quit 后本机/远端进程与后台 HTTP 服务均继续，A 转发关闭；强杀整个 Electron 后同样验证其 SSH master 被清理，B 实例和任务不变。
- 早期一轮心跳后来结束，原因未确定；新的同一远端 PTY 重开 attach 时已运行约 1,051 秒，之后在整个 A 被强杀的检查中，心跳计数由 1,096 增至 1,100。该任务后来在 11:15 Stop 故障时实际结束；此前窗口的通过记录保留，不延伸到故障之后，也不能表述为无限运行证明。
- GUI 实际制造 B 创建成功后的响应丢失并关闭 A 自有 SSH master；自动恢复后点击 Check pending 显示 Completed，再次查询为空。B 执行次数和 operation row 均为 1，workspace 数由 2 到 3，没有自动重放。主进程出现预期 transport 错误，renderer 无错误；不能将此故障注入表述为所有日志无错误。
- 文件/Git 的真实 GUI 检查已读取远端文件，确认保存控件禁用且源文件 hash 未变，并刷新 Git main 分支与测试文件列表；renderer 无错误和外部请求。附件未建立 chat session，未完成 Attach 操作，仍列待验收。
- installer 的两项真实 SQLite 试验使用 Node 内置 SQLite 注入适配；生产 Darwin release 的 better-sqlite3 原生驱动尚未验证。incoming admission 最多允许四份 2GiB slot，既有残留各占完整 slot；失联残留不会自动删除另一台 A 的上传，满额时拒绝新上传。跨 ABI/schema/PTY bundle 的版本拒绝自动激活，尚未实现停机迁移。

已脱敏的关键运行观察保存在[证据摘要](evidence/ssh-direct-linux-2026-10-10.json)。早期裸 Xorg 检查的 Ctrl+Q 未触发退出，实际 File→Quit 通过；本轮原字节产物的真实 XTest Ctrl+Q 已退出并通过复连检查。容器的系统 Chromium sandbox 阻止了外部浏览器启动，不能将端口 HTTP 成功等同于系统浏览器成功。原生 Mac Force Quit、ASAR 包装与实际 vendor chat 仍未验收。

新 profile 隔离 Superset token、旧 hook 和默认 vendor 配置目录；用户 shell 的普通 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`CLAUDE_CODE_OAUTH_TOKEN` 等仍保留。去 Superset 账号不表示删除用户的模型认证。

## 验收矩阵

| 编号 | 当前可证明范围 | 尚待验收 |
| --- | --- | --- |
| A01 | 无账号默认入口，完整 Electron 构建实际启动无外部 renderer 请求 | 原生发行包及物理 Mac。 |
| A02 | 全部签名安装/打包源码、故障与完整性测试 | 真实无开发工具 Mac 的完整发行安装。 |
| A03 | 普通 UID/受控 home 与 provider 隔离源码 | 无 GUI 的 launchd、后台 Git/HTTPS/模型认证。 |
| A04 | arm64/x64 构建与原生 smoke 门禁 | 两种真实 Darwin 架构的签名产物及运行。 |
| A05 | 最新 UI 本机 session/PTY、SSH session、远端项目 import，cwd 可见 | 真实 Mac clone/Git 凭据与所有目录类型。 |
| A06 | Electron 关闭/重开、原生 File→Quit、整个 A SIGKILL，B 同 PID/实例和增长心跳 | 真实 Mac Force Quit 与原生包装生命周期。 |
| A07 | 持久 chat 接受、恢复与 lifecycle 测试 | 真实供应商已认证 chat turn 的两机持续执行。 |
| A08 | 持久操作/stale generation 回归；GUI 实际丢弃已提交的创建响应，恢复后可对账且 B 只执行一次 | 原生 Mac 与供应商 prompt 的响应丢失组合。 |
| A09 | daemon 保留/采用与 supervisor 恢复源码 | 完整故障组合；daemon 全套存在已复现的基线期望不一致。 |
| A10 | 独立 job/disabled 状态源码 | Mac 重启、睡眠、用户 logout。 |
| A11 | 锁、身份隔离、事务与并发边界测试 | 两台 A、两 OS UID 的实际并发安装/回收。 |
| A12 | 私有端点、pins、generation、SSH 安全配置与端口回归 | 真实 Mac host-key 变化及完整 UI 提示。 |
| A13 | busy/drain/冻结、兼容性拒绝测试 | 真实活跃 vendor chat/审批等待的 launchd 更新。 |
| A14 | 上传故障、持久恢复、回滚与提交丢失测试 | 真实 Mac 原生 SQLite 备份、migrations 与回滚。 |
| A15 | 本机 explicit Stop、受保护真实三 namespace 隔离和信号对账；远端控制测试 | Mac job 的 stop/uninstall/repair 实际行为；原 11:15 事件仍缺完整信号记录。 |
| A16 | 真实 HTTP/WS mux；UI workspace 端口转发及非 workspace 拒绝；远端文件只读与 Git 刷新 | GUI 附件、Mac 外部浏览器及完整文件编辑闭环。 |

尚未发布或部署签名后端、未生成/使用生产签名私钥。发行流程需要发布者提供私钥并在客户端独立嵌入公钥，见[安装运行说明](../../packages/direct-install/README.md)。Linux 验证不替代上述 Mac 验收。
