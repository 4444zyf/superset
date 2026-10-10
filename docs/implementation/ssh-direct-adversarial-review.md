# Superset SSH direct：独立对抗式审查

日期：2026-10-10。审查源码位于 `/workspace/superset`，基线实现 checkpoint 为 `07076caf2`，其后的桌面、导入器和 incoming 修订按 owner 通知的稳定窗口检查。审查不编辑仓库、不提交代码；复现文件只在 `/tmp`。

## 当前结论

已确认的账号隔离、PSK/私有端点、A 退出清理、generation、冻结/持久操作、安装信任链及导入数据安全问题已修复并独立复验。最后新增的安装 payload FIFO 无截止阻塞 P1、本机自动重连隐式启动 P2、中文路径分块解码 P2、已关闭 pane 的 provider capture 遗漏 P2 均已关闭。

**新增 P1：按终端名称跨系统会话扩大信号目标，已经最小修复并完成真实旧/新 PTY 对照及三 namespace 桌面 Stop 验证。** 原 11:15 两旧任务同步退出的事件缺少当时信号 trace，仍保留无法完全追溯的边界，不冒充该历史事件已经因果闭环。最新 native Quit/重新连接验证也已独立审阅通过，本报告冻结为当前结论。

incoming 最终取消/子树清理已独立复验：producer wrapper 在 ack 前保持存活，超限先 STOP own wrapper、清理 find/stat 后代、wait 后再删除本次 FIFO/释锁。最终 incoming+reader 15 项通过，包含真实 producer/sleep 后代、并发最后 slot、FIFO/hardlink/超量拒绝。

这是源码与 Linux 阶段检查，不是物理 Mac 或完整发行验收。真实 Mac、签名 Darwin 产物、无 GUI launchd/后台认证、真实 vendor chat、重启/logout/睡眠与跨 ABI/schema 的升级等边界仍见下文。

## 原始未归因事件与当前修复验证

最终 fresh import-v2 桌面只点击新本机 namespace 的 Stop，disabled 写入于 11:15:04.167，所属 daemon 收到 SIGTERM 的日志更新时间为 .211。原本机 terminal 在 .278、远端 terminal 在 .291 标记 exited；旧任务 PID 79596/72994 均成为 PID1 下的 Z，旧 shell/session leader 79212/72779 消失。两个旧后台服务和 daemon 仍在，远端 HTTP 任务仍在。新命令 127058 只是单次 console.log 的 PID，早已正常结束；Stop 的对象是其仍运行的 PTY shell，现场没有保存该 shell 的 TTY 坐标。

运行 owner 从初始截图核对了两个旧命令，均为无限 setInterval 每秒写心跳并输出，无退出 handler、unref、deadline。没有 shell cleanup/pkill；CDP 竞争不能解释此次实际任务退出。完整元数据保存在团队证据 `runtime-verification/final-source-stop-anomaly.json`；本审查独立读取旧进程 stat、DB ended_at 和 daemon 日志更新时间。

现存旧 Node Z 的 `/proc` field52 为 0。独立直接子进程校准的 TERM/KILL/HUP 分别为 15/9/1，但 core 的真实 kill-tree 自有孤儿被杀后也出现 field52=0，说明不能将直接父子校准推广到此环境的 PID1 孤儿；该字段既不能证明也不能排除信号导致退出。

当前 collector 回归证明基线会将同名 pts/0、不同系统会话的 PID900 和 PGID900 选入信号目标；修复以 Linux sid/Darwin opaque sess 限定 TTY 扩展，缺失或全零 session 时禁用该扩展，仍保留 PPID 树与已知 PGID。独立基线文件在 `/tmp`，仅收集目标，没有发信号。现场两个旧 backend 位于不同 devpts 挂载而共享 PID 视图，使终端名称碰撞确实可能。当时需要可追踪的真实多 namespace Stop 验证，随后已经完成，具体证据见下文；修复验收依据包含实际信号目标，不仅是纯函数回归。

后续新增真实 Linux PTY 协议 close 对照，团队执行、独立核对元数据及全部 JSONL：`/tmp/direct-core-pty-ba6c-baseline/proof-signals` 的旧 collector 有 12 次 foreign 信号企图，被私有 ownership gate 拦截；其中主 close 的 pts/1 误选远端 HTTP shell/task 的 PID 和 PGID，共 4 次，测试结束清理 padding PTY 的 pts/0 误选两个 survivor namespace 的 shell/task，共 8 次。还有 2 次 absent-pid 记录。`/tmp/direct-core-pty-sid-fixed/proof-signals` 相同 gate、协议场景及清理只有 owned 信号，无 foreign 企图，1 次 absent-pid。不能将 1 次 already-gone/合成 ESRCH 改称 OS 实际发信号，也不能将新版总 blocked 写成 0；准确结果为 foreign 0、alreadyGone 1。实际同 TTY/不同 session 的跨 namespace 信号缺陷已得到真实路径证明，但原 11:15 事件没有当时 signal trace，仍不冒充因果闭环。

最新三 namespace 桌面 native Stop 资格验证通过，source `d89278ab7`，生产 Desktop fingerprint `bb243484f1e335d762afdeb26648754453dbc5197444b93105ddd8167fd79c0e`。团队执行后，我独立读取 raw JSONL，从 Continue 点击前审计到 after-stop 的 11:41:19.377：10 次非零 signal attempt 的所有 target/member 元数据均与 stopped namespace 的 PID/startTicks/SID 匹配，7 次实际成功，2 次 absent-pid/group 合成 ESRCH 单列 alreadyGone，0 outside-owned block、0 foreign-to-stopped attempt、0 survivor attempt。selected namespace 的 supervisor/backend/daemon/shell/task 全部不存在，disabled 保留、endpoint 删除。原本机新 survivor142539 心跳 288→370、远端新 survivor142880 心跳265→347，均同 PID/startTicks；原 HTTP83561 仍同实例响应。三个任务都为 /dev/pts/0/ttyNumber34816，SID 和 devpts 挂载不同。

诊断工具使用私有 dist mirror 给 supervisor/backend/pty-daemon 三个 helper 显式加载 ownership gate，main/preload/renderer 保留生产基线；不能称整应用未修改的生产运行。我独立逐文件比较 dist：只有这三份 helper 变化，都只添加一行带 use strict 的 require prefix，其后完整原始 bytes 一致，严格模式保留。共用 registry 可允许全部新测试 namespace，所以此次另按 stopped namespace 逐目标审计；gate 没有拦截本身不作为隔离通过依据。完整证据是 `runtime-verification/stop-isolation/{before-stop.json,after-stop.json,stop-signal-metadata.json,mirror-artifacts.json}` 及 `postfix-run-1/signals-*.jsonl`。

| Instrumented helper | 实际 SHA256 |
| --- | --- |
| direct-supervisor.js | `db2328f2d7a430ff0a353bb6850b3ebd66c0f437e2ddd9a9cd2602e1dbe58312` |
| direct-backend.js | `b8e9e427803bf3300002ff71bf1a2c64f3210609229befca632e66b07da054aa` |
| pty-daemon.js | `2e5850795dce771fe277eb1cf29141075b7acb8284553e8289490898216f39f8` |

随后生产原字节 fingerprint bb243 的 A147364 经真实 XTest Ctrl+Q 退出，退出码0；A148285 重开后，实际手动 Connect、选择 workspace/terminal，画面恢复同两个 survivor。`native-quit-and-reopen.json` 中本机心跳476→477→507、远端453→454→474，PID仍为142539/142880。独立检查两份 restored 截图，显示相应 workspace 路径及最新 survivor-running PID；独立再读当前 `/proc`，两进程仍非Z、startTicks与 Stop 前完全一致，原 A147364 已不存在。此阶段 A 使用未修改生产文件，survivor 诊断 fixture 仍有私有 signal gate；不能扩称全部后台和测试进程未经诊断修改。两次 renderer errors/observed requests均为空。证据位于 `stop-isolation/native-quit-and-reopen.json`、`{local,remote}-survivor-restored.json/.png`。

早期 bare Xorg Ctrl+Q 失败是历史证据，不覆盖最新真实输入和 exit0 的成功。最新恢复的是新诊断任务142539/142880，不是已经死亡的旧72994/79596；旧 B bundle 未在本轮升级，也没有真实 vendor chat 的登录与持续执行验收。

Darwin 格式另核对 Apple OSS adv_cmds 的 `ps/keyword.c`：sess 对应 e_sess/KPTR/"lx"，当前 opaque hex parser 与其源码输出一致，仍未在物理 Mac 执行。core 的 patched 真实 Node kill-tree 3/3 日志已只读核对，同 session 的 orphan/escalation/TTY straggler 清理保留；最新完整 PTY Node 套件为 51 pass/7 fail，总 58 项，不称整套绿色。后续基线对照已经结束：仅选择三个出现失败的测试文件，得到35 pass/7 fail，总42项，这不是完整基线套件。四项普通 I/O 失败在基线复现；detached-helper 的活性检查用 kill(pid,0) 将 Z 误判为仍运行；byte-fidelity 的 ECONNRESET 和 handoff 在相同 ownership guard 的基线也复现，但 guard 对这些失败的影响未完全归因，不能将全部七项笼统关闭为已证明无关的基线问题。此后停止 probes，没有继续测试或放宽超时。该 3/3、完整58项及基线42项为 owner 执行，不冒充独立重跑。

## 已关闭问题

| 严重级别 | 问题与结果 | 独立核验依据 |
| --- | --- | --- |
| P0 | direct 启动仍导入云端必需 env。现在云模块懒加载，clean env 不依赖账号参数。 | emitted Node bundle 的 clean-env import 通过；direct 启动路径不构造官方 API/relay。 |
| P0 | root 安装读取 UID 可变 payload/PSK、继承 NODE_OPTIONS。现在 root 执行 A 验签后固定 digest 的 root-private Node/installer；其他数据由 UID 子进程读取；root env-i。 | 签名、内容、symlink、权限、环境和 UID 控制路径的源码及回归。未宣称真实 root/Mac 部署。 |
| P1 | 同名 TTY、不同 OS session 的外部 PID/PGID 被列入信号目标。现在 TTY 扩展必须与 root 的非零 session 一致，缺失时禁用扩展。 | 独立基线 fixture 外部900排除、straggler200保留；8 pass/20 assertions。真实 PTY 旧版 foreign12→新版0；三 namespace native Stop 的每个信号均在目标内，L/R 同PID心跳增长，foreign0/alreadyGone2。原11:15历史事件未完全追溯，instrumented Linux 非物理Mac。 |
| P1 | 旧 B TCP 端口被其他 UID 抢占后可能接收 PSK。新增秘密消费路径都使用精确的 owner-only Unix socket，没有 TCP fallback。 | manager/local/installer 共用短 socket 摘要；真实 Unix/SSH streamlocal Linux 证据及秘密未发往恶意 TCP listener 回归。 |
| P1 | A SIGKILL/SSH 自退出遗留代理 listener。watchdog 清理自己拥有的 SSH process group，B 工作不因此停止。 | 独立真实 Node 3 项；团队真实 OpenSSH SIGKILL 证据前后 B 同 PID。 |
| P1 | 迟到 RPC body、连接编辑、迟到本机 proxy 使用旧 generation 或泄漏资源。现在响应读取后重查 profile/generation，每 caller 独立代理，取消独立回收。 | direct-connection 47 项及类型检查；名字修改保留 pins、地址修改清 pins。 |
| P1 | drain/frozen 仍可启动终端、后台 PR 回调继续写，提交响应丢失后误回滚。现在统一维护边界与持久 preparing/committing/rollback-committing。 | 原始 terminal/后台副作用/SQL 冻结及持久操作回归；提交可能开放写入后不恢复旧 DB。 |
| P1 | 旧 committed journal 删除另一 A 新 stage。现在发布、消费、retention 共用 namespace install.lock，只消费匹配候选。 | matching candidateReleaseId 回归及源码接线。 |
| P1 | 私有配置 FIFO 在 fstat 前阻塞。现在 O_NOFOLLOW/O_NONBLOCK，加 owner、regular、实际长度上限；root→UID 子进程设截止。 | 真实 Node FIFO 测试；独立见证去掉 O_NONBLOCK 红、恢复绿；READY→GO 保持 800ms，不加 timeout/retry。 |
| P1 | 早期 bootstrap 与持 global install.lock 的 manifest UID head 读取无截止，source FIFO 可无限等待。现在 bootstrap trusted completion/ack wrapper 30 秒截止、STOP own parent 后清理子树；manifest direct UID head 30 秒 SIGKILL。 | 原 exact head 对 FIFO 250ms 阻塞；最新 bootstrap/payload/install 9 pass/32 assertions；两生产调用及剩余 manifest 接线确认。 |
| P1 | importer 回滚恢复旧目录后再崩溃，第二次 recovery 删除已恢复数据；回滚失败也释放锁。现在 hadOriginal/rolling-back 持久证据，目录 fsync 后标 rolled-back，只有 fully resolved 才释锁。 | `/tmp/superset-review-import-recovery.ts` 红→绿；实际 EACCES 保留恢复锁；最新导入/恢复回归见下表。 |
| P2 | 合法同项目 local/branch workspace 共享 checkout、archived/deleted 路径复用被误判冲突。现在区分合法共享与历史 tombstone。 | 真实 schema 独立 fixture 红→绿；v1/v2 两条映射回归。 |
| P2 | PATH alias 或异步 login shell env 合并恢复旧 Superset wrapper/默认 provider 目录。现在 realpath 校验及最终 isolation overlay。 | 独立 66 项 vendor/env/default-account/CLI 测试。用户普通模型密钥仍保留，见范围限制。 |
| P2 | 不完整 building backup 挤掉上一份 complete snapshot。现在创建前记录 building，只从 complete 中选上一份。 | partial+throw 注入及 GC 回归；SQLite WAL/restore 两项真实 Node 使用注入适配。 |
| P2 | incoming 容量 checker 退出后 producer 可能继续遍历或留下后代。现在 private metadata FIFO+completion/ack，按本次 owned wrapper 子树清理后才释锁，不删除另一 A partial。 | 最终 incoming11 + bootstrap3 + payload1：15 pass/44 assertions；真实后代取消及最后 slot 两 A 竞争。 |
| P2 | importer child 超量输出继续追加、只 TERM 不 KILL、早于 close 释放生命周期；分块 UTF-8 损坏中文路径。现在 byte cap、销毁 pipes、TERM→KILL、close 后单次 settle、StringDecoder。 | helper 3 pass/9 assertions；中文路径独立 split fixture 从 U+FFFD→完整原路径。 |
| P2 | 已关闭 pane 的静态历史保留，但仍可证明的 provider session capture 遗漏。现在 capture 白名单传入归档；多历史 workspace 归属冲突拒绝，不创建活 terminal。 | mapper 13 项与完整 importer 接线；独立 fixture captureRetained:false→true、liveTerminals 始终 0。 |
| P2 | 自动重连本机 endpoint 缺失时调用默认 local.connect 并 spawn supervisor。现在 AutomaticReconnect 强制连接 kind，只 arm SSH。 | 6 pass/27 assertions；实际 LocalBackend/自动引擎+owned Unix fixture auto spawn 2→1。本机故障改为手动 Connect/Start。 |

新导入器支持一次一份 offline v2 namespace 或 v1 local.db→停止的空本机 namespace；不全量覆盖/合并，不移动仓库，不执行旧配置。旧 actor 保留；v1 schema 无 actor 的记录置 NULL 并告知；旧终端/chat 成为停止或 interrupted 的历史，排队 prompt 不自动重放。v1 历史 metadata 只投影 cwd/cols/rows/startedAt/endedAt/exitCode，原 scrollback 保留为静态数据。

Bun importer fixture 的一次 Source data changed 已查明：默认 db.close(false)/sqlite3_close_v2 留存 statement，晚 finalize/GC 才 checkpoint 或删除 WAL/SHM。测试 fixture 改 close(true)，新增确定性红→绿回归，生产 fingerprint、timeout 与数据安全检查没有放松。独立最终 34 项含该回归；团队的 `/tmp/superset-bun-close-lifecycle-proof.json` 对照 false/true 明确证实因果。

bootstrap 新 helper 的三项测试首次即绿，未称这三项均是 red→green。manifest head deadline 回归有真实旧行为外层 400ms 被杀→新内部 25ms 结束的证据。历史原始 head FIFO 的独立负例也不是实际 sudo/Darwin 测试。

## 最新实际执行命令

以下有覆盖交叉，不能相加作为唯一总测试数。较早检查后的源码只有在新变动范围相关时重跑；未把 owner 的完整测试计数冒充独立执行。

| 独立命令或范围 | 实际结果 |
| --- | --- |
| `bun test packages/pty-daemon/src/process-tree.test.ts` | 8 pass，20 assertions；Linux decimal/Darwin opaque session parser、同 TTY 跨 session 排除、缺失 session 禁用扩展。 |
| `bun test packages/host-service/src/direct/legacy-import.test.ts packages/host-service/src/direct/legacy-v1.test.ts packages/host-service/src/direct/import-lock.test.ts` | 最终 34 pass，132 assertions，含 v1/v2 writer/journal/rollback/history/startup guard 与确定性 Bun fixture 关闭回归。 |
| `bun test packages/direct-connection/src/local-import-process.test.ts` | 最终 3 pass，9 assertions；overflow、deadline、UTF-8。 |
| `bun test apps/desktop/src/main/lib/ssh-direct/automatic-reconnect.test.ts` | 最终 6 pass，27 assertions；仅 SSH 自动重连。 |
| `bun test packages/direct-install/src/bootstrap-reader.test.ts packages/direct-install/src/payload-reader.test.ts packages/direct-install/src/install.test.ts` | 最终 9 pass，32 assertions。 |
| desktop import helper/entry + Workstation | 10 pass，29 assertions。 |
| local lifecycle + child cleanup，上轮 helper 2 项时 | 12 pass，86 assertions；较新的 UTF-8 第三项另见上行，不重复汇总。 |
| `bun test packages/direct-install/src/incoming.test.ts packages/direct-install/src/bootstrap-reader.test.ts packages/direct-install/src/payload-reader.test.ts` | 最终 15 pass，44 assertions；与之前 reader 9 项交叉覆盖，不能相加。 |
| direct-connection Bun + typecheck | 47 pass，180 assertions；类型检查通过。 |
| SSH watchdog Node | 3 pass。 |
| desktop main/lib/ssh-direct | 36 pass，157 assertions。 |
| desktop reconnect + Workstation + RemoteChat，上轮无本机新限制时 | 13 pass，57 assertions；新引擎 6 项见上行。 |
| host vendor/env/default-account/CLI | 66 pass，176 assertions。 |
| host operations/chat durability/supervisor/startup | 17 pass，38 assertions。 |
| installer control-runtime/user-maintenance | 14 pass，39 assertions。 |
| installer Node SQLite WAL/restore | 2 pass；使用 node:sqlite 注入，生产 release 仍 better-sqlite3。 |
| host `test:integration:direct` | 4 pass；Unix 2、FIFO reader 1、resident local log maintenance 1。 |
| direct-connection `test:integration:local` | 1 pass；FIFO READY 后 800ms 截止。 |

本次无仓库写入；独立复现文件包括 `/tmp/superset-review-import-recovery.ts`、`/tmp/superset-review-import-local-workspaces.ts`、`/tmp/superset-review-import-utf8.ts`、`/tmp/superset-review-closed-pane-capture.ts`、`/tmp/superset-review-local-auto-launch.ts`。测试自有 HTTP/Unix server 与 socket 已关闭，直接 child 已 wait/reap；后代取消断言为进程消失或 Linux Z 状态，证明不再运行，不等于宣称所有孤儿已被容器 PID1 回收。

## 团队运行证据与独立审查范围

下列证据由实现/运行 agent 生成，我只读审查其字段与源码匹配，不能当作自己重新执行，也不能当作 Mac：

- `/workspace/.cloud-onboarding/superset/runtime-verification/ssh-unix-proof.json` 与 `orphan-unix-proof.json`：真实 Linux OpenSSH streamlocal、A SIGKILL 的 owned listener 回收，B 前后同 PID。
- `/tmp/superset-local-unix-persistence-check.json`：UID1000 客户端退出后 PTY 心跳增长，同 terminal 复连/WS attach，显式 Stop 数据保留。
- `/tmp/superset-import-native-proof.json`：Node24.19 ABI137 普通 UID1000，生产默认 SQLite driver 与 system lsof；v2 writerFixture=sqlite-handle，v1 writerFixture=terminal-history-file-handle。两者 sourceFilesUnchanged、sourceWriterRefused、stoppedAfterImport 为 true。早期 v1 false 表示未跑，最终证据已补该场景。
- root/runtime agent 的最新 Electron UI、File→Quit/强杀、PTY 保留与端口验证参见已提交实施记录；我不把早期 GUI 证据覆盖到最后 importer/incoming 修订。

## 外部边界与尚未完成的设计范围

- 未在物理 Mac 运行；BSD stat 分支、system launchd、两 OS UID/两 A 并发、无 GUI trustd/Keychain/TCC、reboot/logout/sleep、原生 Force Quit 均不能记为发行验收通过。
- 双架构 Darwin build 必须在匹配 Mac worker 验证 Node/ABI/native SQLite/PTY/watcher 后签名；尚无此完整产物，没有生成或使用生产签名私钥。
- 最新 Electron 本机 helper 的 source/build 配置使用同 Electron execPath/ELECTRON_RUN_AS_NODE 与 native asarUnpack/npmRebuild；最终 packaged macOS ASAR/native 尚未独立验证。
- Linux 最新 native Ctrl+Q 与重新连接已验证；系统浏览器启动仍被当前 sandbox 阻止，不能把 HTTP/WS 代理已响应等同系统浏览器成功打开。
- vendor profile 与 Superset token/hook 默认目录被隔离；用户 shell 的 ANTHROPIC_API_KEY、OPENAI_API_KEY、CLAUDE_CODE_OAUTH_TOKEN 等仍保留。不能声称模型账号均已清空或必定未认证。真实已认证 vendor chat 持续执行/审批等待的两机验收仍缺。
- 兼容候选的持久激活/备份/回滚已有源码与回归；protocol/schema/migrations/Node ABI/PTY digest 不兼容的停机迁移明确拒绝，不能声称跨版本 schema/ABI 升级已实现。
- importer 一次一份 v1/v2→空目标。源组织目录显式记入 journal；多源自动发现、全量冲突分 namespace UI 没有实现。静态历史已保存，不等于 terminal UI 已能直接回放或供应商 session 在新 profile 必定可恢复。
- incoming 将四份 UUID slot 各按 2GiB 满额预留，总上限 8GiB；失联残留占 slot，不自动删除另一 A 的未知活动目录。四个残留可能要求用户确认后手动清理；最后 producer 生命周期 11 项 Linux admission 已独立通过；BSD stat/真实 Mac 仍未跑。
- tRPC 使用 `.agents/skills/trpc-compat/SKILL.md` 对照源码：新增输入 optional，旧云 branches 保留，既有输出形状未见破坏；缺完整发行 tags/线上 usage 数据，不能称已验证全部 released clients。新 direct procedure 不声称可被旧官方 host 兼容。
- daemon 全套存在 root 在未改基线复现的已知失败，不能列整套绿色；本轮定向通过没有改写此边界。

上述证据支持阶段 checkpoint，不支持将 A01–A16 整体标成真实 Mac 发布验收完成。
