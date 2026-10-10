# SSH 直连与自动安装守护后端：设计复核

- 复核对象：[最终设计](ssh-direct-backend.md)。
- 日期：2026-10-10。
- 源码基线：`4444zyf/superset@4ec5b6e287d380480a71b4b2ad98976354c82d4f`。
- 方法：本次静态自审，对照仓库源码、进程生命周期及故障场景；没有独立审查者参与。
- 范围：只编写设计与复核文档，没有修改应用实现、生成发行包或实际连接 Mac mini。

## 1. 结论

建议采用设计中的 **系统 OpenSSH 转发 + 独立 direct host-service + launchd 托管** 方案。它明确把执行资源留在 B，将 A/SSH 连接的生命周期与远端服务、PTY、chat runtime 分开，能够作为后续实施依据。

静态审查发现的高影响缺口已补入设计：真正移除云端启动依赖、系统服务权限、完整原生发行包、远端路径选择、持久操作去重、升级 drain、共享安装锁、候选启动的外部副作用以及破坏性 PTY 修复。下表的“已纳入”表示文档约束已补齐，**不表示产品已经实现或运行验收通过**。

发布仍以设计中的 A01–A16 实机验收为条件。尤其是 system LaunchDaemon 下的 trustd/Keychain、launchd 对子进程的清理、native ABI 与供应商 CLI，源码阅读不能替代真实 macOS 测试。

## 2. 用户要求与方案对应

| 用户要求 | 方案中的保证机制 | 验收 |
| --- | --- | --- |
| 移除 Superset 账号体系 | 本机工作台入口、SQLite 连接表、SSH OS 身份 + 本机 PSK；direct core 不依赖 org/JWT/云 ApiClient。 | A01 |
| A 安装客户端后添加 SSH Mac mini | 使用系统 OpenSSH；探测 UID/架构/home，上传完整签名包并自动登记、启动服务。 | A02–A04、A12 |
| 在 B 添加项目和创建会话 | 路径浏览、clone、workspace、SQLite、agent 启动均由 B 的后端处理。 | A05 |
| 不走官方 relay | HTTP、WebSocket、附件和开发服务器转发均经 SSH 到 B loopback；阻断官方域名验证。 | A01、A16 |
| 关闭 A 后 agent 继续 | launchd 托管 supervisor；B 服务不依赖 SSH stdin、A PID 或连接心跳；A quit 仅释放本地连接。 | A06、A07、A15 |
| 重开 A 接回原会话 | 稳定 backend/session/terminal ID、操作 journal、PTY attach 与 chat 历史读取。 | A08、A09、A12 |
| 自动安装后长期可用 | 发行物校验、权限隔离、安装 journal、分离安装与激活、故障恢复和有限回滚。 | A11、A13、A14 |

前提已经显式写入：SSH 可达且 Remote Login 已开启；无人 GUI 登录的默认模式需要一次管理员安装；供应商/Git 凭据存在 B 上且适合后台使用。A 退出后的持续执行不等同于 B 重启、断电或睡眠时继续执行。

## 3. 发现的问题与处理结果

| 编号 | 问题及源码证据 | 设计处理 | 状态与验收 |
| --- | --- | --- | --- |
| R01 | 仅替换 relay URL 后，旧后端仍要求组织/账号 token，`createApp` 还构造云 ApiClient。[env][env]、[app][app] | 7.1–7.2 新增无账号客户端入口与真正的 direct core；云功能从依赖边界拆开，不能注入假 token 或全成功 API stub。 | 已纳入；A01 阻断官方域名。 |
| R02 | 用户 LaunchAgent 依赖登录 domain，不能据此承诺无 GUI 登录时常驻。[Apple 文档][launchd] | 6.1 默认 system LaunchDaemon 以目标普通用户运行；6.2 用户域模式明确降级；管理员授权仅作用于安装器。 | 已纳入；A03、A10 实机验证。 |
| R03 | `host-service.js` 不是完整部署物；现有 CLI 还打包 Node、worker、PTY 和原生模块。[build-dist][build] | 5.1 提供按 macOS 架构和 Node ABI 的完整 bundle，签名/摘要验证；不依赖 B 的 npm/Bun/Homebrew。 | 已纳入；A02、A04。 |
| R04 | 本机 quit 有完全清理路径；host-service dispose 还会关闭 chat runtime。不能仅保护 PTY 就宣称所有 agent 常驻。[quit][quit]、[chat dispose][dispose] | 2、3.3、8.4 分别定义终端和 chat 的所有权；远端 HS/PTY 不属于 A，Quit Completely 不清理连接表中的 B。 | 已纳入；A06、A07、A09、A15。 |
| R05 | 当前新项目 UI 使用 A 的目录选择，远端连接状态不意味着后续文件操作已经在 B。[项目 UI][project-ui] | 3.2 使用后端远端目录浏览与校验，B 上执行 clone/import/cwd；远端路径与本机路径分开。 | 已纳入；A05。 |
| R06 | 连接断开后的本地端口可能被复用；现有远端 URL 解析按 relay 生成地址。[URL 解析][url] | 4.2 以 connectionId + generation 管理 endpoint lease，校验 backendId/namespaceId/UID 与 PSK；旧客户端和缓存不跨连接世代复用。 | 已纳入；A12。 |
| R07 | chat command 去重目前是内存 Map；丢失响应或 HS 重启后重试可能重复接受操作。[去重实现][dedupe] | 8.3 引入持久 operationId/input hash、状态与结果 journal；先查询再决定重试；终端 keystroke 不自动重放，不承诺外部副作用 exactly-once。 | 已纳入；A08、A09。 |
| R08 | chat 在 HS 内，升级重启会中断 active/queued/waiting turn；多 A 会在“检查为空”后发新请求。 | 9.1 先服务端 drain，再在维护锁内检查；允许已有审批输入，阻止新任务；默认等任务结束，安装候选与激活分离。 | 已纳入；A11、A13。 |
| R09 | 旧 `system.update` 请求云端 owner 授权；普通用户自更新还假设安装目录可写。[system.update][update]、[安装锁][lock] | 7.2、9.1 关闭官方更新路径；root-owned 新发行物经固定特权安装器登记，用户态 supervisor 只做已验证版本的激活。 | 已纳入；A01、A14。 |
| R10 | 只按 namespace 加安装锁不能保护多个 UID 共享的系统 release/launcher。已有锁注释也要求所有安装写入者共享锁。[安装锁][lock] | 5.2 增加系统安装级锁和 UID/namespace 级锁，固定获取顺序；不可变 release 发布，不能改动其他用户的运行版本/job。 | 已纳入；A11 增加多 UID 检查。 |
| R11 | 只恢复 DB 不能撤销候选启动删除 worktree、改写 provider 文件等外部副作用；现有 app 在启动后执行 sweep/reconcile/purge。[启动任务][sweeps] | 9.2 候选维护模式禁止清理、hooks、自动恢复及文件改写，健康确认前仅开放限定检查；schema 不兼容时备份恢复须处于排他边界。 | 已纳入；A14 必须检查 DB 和外部目录。 |
| R12 | 已有 trustd healing 会 kill 已采用 daemon，源码直接说明 PTY 会话丢失；正常重连不能照搬该策略。[终止路径][healing] | 6.3 活跃任务期间报告降级并延后破坏性修复；9.1 无损 handoff 仅在协议兼容且验证通过时采用。 | 已纳入；A06、A09、A14 加降级/版本漂移场景。 |
| R13 | session 路径写死 `~/.superset/sessions`；单改 `SUPERSET_HOME_DIR` 无法隔离旧产品。[路径][session-path] | 5.3 统一数据路径注入，新 namespace/home/私有短 socket；10 迁移离线进行，不采用或终止官方实例。 | 已纳入；A05、A11，迁移另做专项检查。 |
| R14 | A 的 SSH_AUTH_SOCK 不随 A 常驻；system job 的 trustd、Keychain、PATH 也不同于登录 shell。[trustd][trustd] | 6.4 使用 B 的后台凭据和可执行路径；不默认依赖 A 的 agent forwarding；安装健康和供应商已认证分别显示。 | 已纳入；A03、A06、A07。 |
| R15 | KeepAlive 会恢复退出的 job；“断开连接”和“停止远端”若混用会破坏运行任务或让显式停止失效。 | 9.3 本地 disconnect/remove 保留 B；stop 持久停用 workload，uninstall 操作目标 job 且默认保留数据。 | 已纳入；A15。 |
| R16 | PTY replay 有容量限制；HS 内 chat runtime 退出与 PTY daemon 退出的恢复能力不同。 | 8.4 明确可继续、可采用、已中断和历史可读；不把重新启动 agent 或读取旧记录称为原进程继续。 | 已纳入；A09、A10。 |

## 4. 场景推演

以下是按设计契约进行的静态推演，没有在双机环境执行。

### 4.1 首次安装完成前关闭 A

包上传未完成：没有激活新版本，旧服务不受影响；下次通过 install journal 识别 .partial 并恢复/清理。系统登记或激活事务已提交：该阶段不再依赖 A 的 SSH 进程，launchd/supervisor 依据 durable journal 完成健康检查或回滚。需要管理员授权但尚未获得时，不能凭 A 消失继续提权。

### 4.2 agent 运行时关闭或强制杀死 A

SSH 转发消失，A 的订阅、临时端口和 renderer 消失；B 的 launchd、HS、PTY daemon 与 chat harness 保留。终端 PID 和 chat turn 不由客户端清理。再次连接需要重新验证 B 的身份，然后按原 ID attach/read，不重新创建 agent。供应商请求若依赖 A 转发的凭据，这一保证会失效，因此设计明确要求 B 的后台凭据。

### 4.3 B 已接受创建操作，但响应被 SSH 断线吞掉

A 保留 operationId，重连首先查状态。B journal 返回接受/执行/完成结果；资源 ID 已预分配，HS 恢复时与实际 daemon/session 对账。若记录过期或无法证明外部命令是否已执行，返回明确的不确定状态，不自动重发。该机制需新增实现，当前 Map 去重不足以支持它。

### 4.4 两台 A 同时安装或维护

共享系统发行目录由特权安装器统一加锁；用户数据由 namespace 锁保护。某 A 发起 drain 后，另一 A 的新创建/prompt 被服务端拒绝，已有输入/审批仍可处理。候选下载不要求停掉任务；激活前再次检查 workload，不依赖任一客户端的陈旧 UI 状态。

### 4.5 候选版本启动失败

PTY 保留；候选处于维护模式，不执行 destructive sweep。兼容迁移可回退旧 binary；不兼容迁移在排他边界恢复一致性备份。若已开放用户写入，禁止恢复旧备份丢弃新数据。仍不能回滚的外部迁移必须在发布前被拒绝或单列停机迁移路径。

### 4.6 转发端口复用或 SSH 指向另一台机器

A 的旧 endpoint lease 失效；即使同一端口再次有服务，也必须通过新 generation 的 PSK/身份检查。host key 变化遵循 OpenSSH 的安全交互；不静默忽略。backendId/namespaceId 不匹配时不得把旧 host 的 session 缓存绑定到新服务。

## 5. 实施前和发布前检查

本次文档检查包括源码证据位置、交叉引用、要求覆盖和生命周期/故障推演；没有执行功能测试。后续实施应按设计第 11 节推进，最终完成第 12 节全部 A01–A16。

最先验证的可行性条件：

1. 真实 macOS 的普通用户 system job：正确 UID/home，trustd/HTTPS、Git、原生 PTY、供应商后台凭据都可用；检查 job 重启和 bootout 是否影响被保留的 PTY。
2. 全新无账号环境且官方服务被阻断：客户端/direct core 可启动、在 B 创建项目/session、处理所有 HTTP/WS/附件/fwd 通道。
3. 运行中的 terminal 与 chat 分别关闭 A：同一远端执行继续完成，重连无重复创建；再验证 HS 崩溃时两类 runtime 的真实恢复差异。
4. fault injection：响应丢失、并发创建/升级、trustd 降级、候选健康失败、非兼容 migration，以及候选的外部目录不被清理。

后续还必须完成各架构和客户端平台的发行检查、签名/解压验证、权限/秘密日志检查及离线数据迁移验证。这些是发布工作，不能将当前静态设计结论转述为测试通过。

## 6. 接受的边界

- SSH 负责认证、控制和数据转发；它不解决网络不可达，且不能延长 B 断电前进程的生命。
- system job 所需管理员安装是无人 GUI 登录的部署条件；无管理员的 LaunchAgent 模式以明确较弱的生命周期提供。
- 同一 OS 用户共享 B 的实例和权限；clientId 是审计标识，不提供组织级权限隔离或单客户端 PSK 撤销。
- 模型/Git 认证、FileVault、睡眠和 GUI/TCC 操作按实际系统能力处理，不能用“后端健康”掩盖供应商或后台环境不可用。
- 活跃 chat 阻止默认激活更新；紧急强制维护会明确中断范围，不承诺所有 backend/daemon 升级都能无损。

[env]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/env.ts#L1-L47
[app]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/app.ts#L75-L131
[launchd]: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
[build]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/cli/scripts/build-dist.ts#L408-L456
[quit]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/apps/desktop/src/main/lib/quit-sequence.ts#L49-L76
[dispose]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/app.ts#L525-L545
[project-ui]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/AddRepositoryModals/components/NewProjectModal/NewProjectModal.tsx#L50-L170
[url]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/apps/desktop/src/renderer/hooks/host-service/useHostTargetUrl/resolveHostUrl.ts#L21-L35
[dedupe]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/chat-runtime/src/commands/commandDedupe/commandDedupe.ts#L1-L39
[update]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/trpc/router/system/system.ts#L17-L47
[lock]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/shared/src/install-update-lock.ts#L12-L39
[sweeps]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/app.ts#L346-L404
[healing]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/daemon/DaemonSupervisor.ts#L273-L304
[session-path]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/trpc/router/workspace-creation/shared/session-paths.ts#L6-L25
[trustd]: https://github.com/4444zyf/superset/blob/4ec5b6e287d380480a71b4b2ad98976354c82d4f/packages/host-service/src/daemon/DaemonSupervisor.ts#L915-L930
