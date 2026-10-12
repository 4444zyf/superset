# SSH 直连后端：2026-10-12 收尾记录

本文接续[2026-10-10 的实现记录](ssh-direct-backend.md)，记录后续获授权的实现和本轮验证。原始[源码现状](../current-state-accounts-remote-sessions.md)和旧运行证据保持不变。日期按北京时间。

## 已提交的修复

`a4c87d79c` 修复终端完成与采用生命周期。瞬间退出的 shell 在订阅建立前完成时，daemon 保留有界的完成输出、模式和 exit；活跃列表与输入不会把它伪装成运行中的终端。缓存最多 32 项、2 MiB、30 秒，仅属于同一 daemon 实例，不是持久历史。复用 terminal ID 后，旧进程的迟到退出不会删除新对象。

采用后的 PTY 正常等待输出 EOF；已释放或没有输出消费者时才检查真实进程状态，显式暂停时继续保留未读取的尾部。`ps` 区分正在运行与 zombie，检查之后再次核对生命周期状态。测试客户端传播实际 socket 错误并等待真正关闭。UTF8 输入使用 POSIX 可移植的 octal 字节；实时 fanout 先建立订阅，再输入，不放宽原字节及顺序断言。

完整 PTY Node 测试 **60 pass / 0 fail / 0 skip**；PTY Bun 测试 **194 pass / 5,913 次断言**。原 7 个 Node 失败已经修复。各次 fail-first 记录及最终命令保留在 `/tmp/direct-core-final-pty-*`，Node suite 已注册到现有 Turbo `test:integration:terminal` 任务。2026-10-10 的原失败记录仍作为历史保留。

`bc9480dbe` 接入本机命名空间、只读旧来源发现、冲突预览和静态历史查询，并完成附件传输的桌面流程。默认已有本机 home 身份被保留；新增命名空间拥有独立持久身份、数据 home、配置、锁和凭据，创建后保持 stopped/disabled。一个固定本机连接选择其中一份数据。

切换先关闭 A 的代理、socket 和端口转发并递增 connection generation，再从私有 catalog 更新可信身份。它不停止旧 B。存在未对账操作时拒绝切换。原生停止确认和手选目录导入在进入时捕获选择及单调 revision，等待期间 A→B→A 也会拒绝旧操作；实际控制/导入期间禁止切换。远端控制确认也会检查目标参数和已绑定身份，等待期间编辑或删除连接不会停止另一个目标。

已发现的旧来源只允许传递 main 生成的 source ID；main 再次发现和确认真实路径。每份来源导入一个新的 stopped 命名空间，不合并、不自动选中、不自动启动，也不要求停止无关的当前任务。旧手选导入仍要求所选目标为空并停用。来源发现只扫描已知本机 homes；预览复制数据库/WAL 到私有临时快照，前后校验 writers 和源字节，列出 UUID、repository/workspace 路径冲突。

静态历史查询不启动后端、终端或 chat。列表最多一页 100 项，文本最多 8 KiB，使用服务端返回的 UTF8 字节游标；异常编码明确报错，避免游标停滞。旧 provider session ID 可展示，但此流程不执行旧命令，也不保证供应商 profile 或 transcript 能恢复会话。

附件使用后端明确声明的 capability。原生选择器读取一个已打开的普通文件 descriptor，并按实际读取字节限制 25 MiB；HTTP 下载固定已校验的 descriptor，保留原文件名、MIME 和字节。B 的 metadata/payload reader 检查 owner、权限、普通文件、ID、长度和路径边界，并拒绝会阻塞读取的对象。UI 的 workspace/连接选择采用单调 epoch，迟到 upload/create/list/download 不会落到新选择；prompt 只引用 opaque attachment ID。

Files 的实际组件测试通过真实文件服务完成编辑、保存和磁盘字节核对；外部写入造成 revision conflict 时保留用户草稿。附件实际 HTTP/tRPC 组件测试核对上传、下载、文件名、MIME 和未认证拒绝。它们属于组件/服务验证；最终 Electron 界面验证另行记录。

## 本轮检查的范围

daemon 修订为 `5ea6f0593`；发行资源接线为 `fc0575dbb`，均已提交推送到 `origin/work`。

| 检查 | 已取得结果 |
| --- | --- |
| PTY 全部 Node 集成 | 60 pass，0 fail，0 skip。 |
| PTY Bun | 194 pass，5,913 次断言。 |
| Desktop main、RemoteChat、RemoteFiles 定向 | 77 pass，294 次断言，16 个文件。 |
| 本机连接、namespace、导入进程 | 21 pass，109 次断言，3 个文件。 |
| host 来源/历史、v1/v2 导入、附件 | 51 pass，179 次断言，5 个文件。 |
| host direct Node | 7 pass，0 fail，0 skip；包含真实私有 FIFO reader 与 supervisor/socket 检查。 |
| host daemon 完整 Node | 33 pass，0 fail，3 个原有 Darwin-only skip；命令正常退出，耗时 26.616 秒。 |
| host daemon Bun | 57 pass，184 次断言。 |
| 类型 | 本阶段 Desktop、host-service、direct-connection 检查通过。最终完整源码检查另行记录。 |
| 独立普通代码复核 | 本机 generation/pins/modal guard、远端确认目标变化及历史游标问题复核通过。 |

独立 Linux Node24 ABI137、原生 SQLite/lsof 流程发现三份来源并预览六类冲突，分别导入三个 stopped 命名空间；源文件 hash 不变，closed-v1 capture 与静态历史可读。证据为 `/tmp/superset-legacy-partition-proof.json`。共享 Electron ABI145 binding 保持不变，没有为了 Node 验证重建它。

上述计数来自各自命令，不汇总为一个去重后的总数。完整 host Bun suite 的既有只读 home 限制没有被描述为全套通过。

完整 daemon 检查还定位了两个真实 Stop race：已进入但尚未登记的启动在 Stop 之后留下 daemon/health timer；迟到的 trustd heal 在停止后又 ensure。修复为 Stop 等待当前 pending start 后清理登记资源，以及 heal 在等待终止之后再次检查同一 instance。两项 fail-first 回归保留，最终整套正常退出。旧“live session 时绝不尝试自动更新”的测试与已有无损 FD handoff 契约不一致，改成实际失败的 handoff 留住 predecessor、shell、session 和 manifest；使用失败记录事件而非固定等待。direct 模式仍关闭自动更新。这一修订不声称已串行化所有旧云更新与停止组合。

## 发行资源接线

新增 Mac arm64/x64 backend workflow，使用对应原生 worker，核对 Node/ABI、原生依赖与 smoke；先对 Mach-O 执行 Developer ID 签名，再封存 Ed25519 manifest。Desktop workflow 下载两套资源，按独立配置的公钥校验架构、版本、协议、schema、Node 与 migrations；仅复制签名清单内文件，恢复 executable mode，再校验复制结果。外层 app 签名跳过已经封存的 B 文件，打包后再次检查，避免重签造成清单 hash 失效。

公钥不从本次私钥派生为信任来源；配置严格只接受 Ed25519 public PEM，私钥必须匹配独立 pin。beforePack 缺少 pin 或完整资源时拒绝生产打包。显式 development package 仅允许 backend 和 key 资源都不存在，不能携带旧资源冒充新的签名发行。发布目标绑定已校验的 `GITHUB_REPOSITORY`，无配置时使用当前 fork。

Node 下载保持 HTTPS，按官方 `SHASUMS256.txt` 校验每次使用的 archive，重新在私有目录提取，避免使用可变的已解压缓存。真实 Linux Node24.21.0 x64 的 checksum→extract→execute 流程通过，ABI 为137；这不是 Darwin 原生验收。CLI 的实际 stage→verify 子进程流程也通过，所用临时 fixture/key 没有进入真实 dist。

发行与安装器定向 **84 pass / 238 次断言 / 23 个文件**；CLI/direct-install 类型检查、scoped Biome、两项真实 SQLite adapter Node 检查、两份 workflow 的 actionlint 检查通过。三个 bootstrap reader 测试将外层同步进程 watchdog 改为异步等待原 helper 自己的截止和清理；内部截止、默认 5 秒和断言保持不变。并行负载下原 82/84 的失败记录保留，最终 root 复跑同组 84/84 通过。

生产 workflow 仍需要既有 Apple 证书及 `DIRECT_RELEASE_SIGNING_KEY`、`DIRECT_RELEASE_KEY_ID`、`DIRECT_RELEASE_PUBLIC_KEYS_JSON`。没有生成或使用生产私钥，没有执行真实 Mac CI、notary、发布或部署。由于 PTY bundle 改变，实际发行须按 runbook 在 release 分支执行 `release --daemon`；本任务没有在 work 分支人工修改发行版本。

## 界面与构建检查点

界面提交 `21c2169b824391fc997ba185ca3e94a6f006dab8` 已推送。Local data 提供命名空间选择、创建及未选中的额外命名空间移除；移除仍须已停止，原生确认取消后刷新真实列表。来源面板展示发现结果、来源计数、冲突和阻塞原因，每份 ready 来源独立导入；静态历史页仅展示文本和保留的 provider ID，分页替换内容，不打开活终端。

切换命名空间不仅清空当前项目/会话/目录/端口引用，也递增前端选择 epoch；即便旧 Connect 还没返回、或已经 A→B→A，旧 descriptor 也不会重新填回界面。原生 main 的 Start/Stop 可以在同一命名空间尚有未对账结果时显式执行，避免后端不可用时无法停止；它仍检查捕获的选择和 revision，操作期间禁止切换。选择、导入和移除继续拒绝 pending，未对账操作不会因这一控制入口被重放或丢弃。

`21c2169b8` 检查点的完整 Desktop `compile:app`、Node host/worker/supervisor 和 PTY daemon 构建通过。Desktop 的 69 个 JS/CSS/HTML 文件 manifest SHA256 为 `15ca1d6ce055966fac754e455cdff47a03cc5caae64c99ea3ca959078b4784bd`。该源码的 Desktop 全量类型检查通过；root 构建后再跑定向 suite 为 **107 pass / 405 次断言 / 25 个文件**。结果包括新增控制门禁回归，未放宽编译 fixture 的 5 秒截止。独立普通代码复核的 UI/coordinator 六文件为 28 pass、85 次断言。

34 条新 UI 文案在 17 个语言目录共完成 578 条翻译；6,430 条消息/语言严格编译无缺失。原有翻译值机械核对未变，仅按实际新文案移除被替换的旧 folder-import 提示。现有 catalog/硬编码 JSX 检查 74 项通过，新增面板位于已经 enforced 的 Workstation 目录。

`21c2169b8` 的 Node 产物与先前空 fixture 所用原字节一致；再次构建逐文件 SHA 核对后用于该检查点的新 B。helper SHA 分别为：

| 产物 | SHA256 |
| --- | --- |
| host-service-direct.js | `baa4cad54b0c21dcbf474acda210cd5c157c3fe4db7ab2b0502961730707c8b7` |
| direct-supervisor.js | `3948ddc78c4563c23a44fe9b3dabfcca73f3bbfec17609893752862f312ada95` |
| host-worker.js | `0873c2ccd997d4f7e8e03b9e5af340bb0fde586dfcaf34c6c886e6ee039c0702` |
| pty-daemon.js | `33545167cf92296f687cfe9102578dab8ee4ca74a76e9276b62441aef9e0d7f8` |

本轮 B 使用新测试 home/身份/凭据与上述 JS，没有给生产 helper 注入信号拦截器。准备阶段私有 Unix describe 返回 200 且身份匹配，附件 capability 为 true；缺失/错误 PSK 为 401，拒绝的 Origin 为 403。真实 OpenSSH streamlocal 请求返回同一已认证身份，关闭本次转发不停止 B。它们是后端/SSH 准备检查，最终 GUI 持续运行结果另行记录。

SSH server 仅监听 loopback，采用本轮临时 key，客户端保留 host pin。云内 server fixture 关闭了 StrictModes；开启它的试验认证失败，当前不能确定完整原因，因此不把此 fixture 作为真实 SSH server 权限配置验收。模拟 A/B 用户 home 仅在各自 child environment 隔离，工具的全局 home 未改变，子进程没有继承用户提供的 SSH 凭据。上述 Linux 准备检查不能替代用户主机或物理 Mac。

Linux 开发 ASAR 包在 `21c2169b8` 检查点实际生成，未重建共享 native，没有触发缺失 platform package 的下载 fallback，使用已安装 Electron41.10.7、ABI145、`npmRebuild:false` 和显式 development package。包内 backend/supervisor 入口、ASAR 外 migrations、原生 SQLite/PTY 已通过实际 SDK 请求；创建会话、执行 PTY 命令、WS attach、断开后重连同一 instance、显式 Stop 与数据保留均通过。它不携带 Mac 签名后端资源，也不包含后述 Codex 修复。

标准 packaged GUI 在独立 display 上因 chrome-sandbox 所有者/模式要求退出 SIGTRAP，未添加绕过参数或修改 SUID 权限；因此该开发包的 packaged-main GUI 未列通过。包内后端功能验证也不等于已完成物理 Mac、签名安装或原生窗口生命周期验收。最终包 hash 和 owned fixture 清理记录在本轮 evidence 中保存。

## 实际界面发现的 Codex 问题

GUI 已完成 TXT 附件上传和原生保存器下载后，第一次发送带附件的 prompt 出现 Zod `turnId` 最小长度错误。生产 Codex resolver/stdio 流程已向受控供应商 fixture 发出一次 `turn/start`；失败发生在附件省略提示还没有本轮 turn ID 时，不能把它当成请求未发送并自动重试。

`2217b95f5e7697e60475d14d6ab2eed237bd2132` 将输入准备改为不发事件，排队同时保留附件被省略标记。收到本次成功的 `turn/start` 响应后，先发送该真实 turn，再使用响应内的明确 ID 发送一次原提示。没有生成随机 turn ID、放宽事件 schema 或新增自动重试；TXT 仍按 Codex 当前能力被省略，并向用户显示提示。

单项回归从原 Zod 错误变为 **1 pass / 8 次断言**；既有 Codex 七文件为 **33 pass / 118 次断言 / 1 项原有真实供应商 opt-in skip**。chat-runtime 类型及两文件格式检查通过，独立普通复核四文件为 **24 pass / 102 次断言**。原 GUI 失败及单次发送证据保留。该提交已推送，后端和 Desktop 构建及同路径 GUI 复测按新的源码检查点记录，不替换正在运行的旧 B 字节。

`2217b95f5` 的 host build、完整 Desktop `compile:app` 及全量 Desktop 类型检查再次通过。新的 Desktop 69 文件 manifest SHA256 为 `38365d9abda25d333f2da66be694c83744caca2222457b6b80c22e1057124ee4`，算法保持为按相对路径排序的 `sha256`、两个空格、路径、换行。新的 `host-service-direct.js` SHA256 为 `99f8406b0b5cf2392a457ad57a5767b658f365937ad7718b8b08c93ec7306dad`，supervisor、worker 和 PTY daemon 三项仍与上表相同。旧 B 和 `21c2169b8` 的完整 Desktop 镜像保留原字节；新旧运行范围分别记录。

## 本轮 Linux 实际界面验收

使用真实 Electron、原生 XTest 输入/文件选择器、OpenSSH、原生 SQLite 和 PTY。CDP 只用于操作和观察真实界面，没有调用替代 UI 的 mock controller。运行 child 使用白名单环境，测试 home/SSH key 均属私有 fixture。裸 Electron GUI 因云 sandbox 前提使用 `--no-sandbox`；这与未绕过 sandbox 的 ASAR packaged GUI 失败分别记录，不能据此声称标准发行 GUI 通过。

`21c2169b8` 原字节检查点实际完成无账号启动、SSH 配置/连接、B 仓库导入、远端和本机 session/终端。远端项目初次创建因 B 测试 home 没有 Git 身份失败，实际 Check pending→Unresolved→原生 Acknowledge 后才显式重试；fixture 补足私有 Git 配置，没有自动重放失败创建。

Files 实际编辑保存后 B 磁盘字节匹配；外部修改后再次 Save 显示 revision conflict，编辑草稿保留，外部字节不变。原生 Attach 和下载 Save 完成 27 字节往返，source、B storage、HTTP GET、原生下载四份 SHA256 相同，文件名正确；未认证/错误 PSK 为401，拒绝的 Origin 为403。带附件 prompt 的原错误另在上一节记录，不能把上传成功视为模型消费了 TXT 内容。

Discover/Preview 在模拟 A 用户 home 找到三份来源，列出六类冲突，并经真实界面分别导入三个新的 stopped 命名空间。每次导入都未自动选中；后续查看历史的显式选择另行记录。两份 v2 的重复项目/workspace/terminal/chat UUID 保留在各自独立数据中。14 份源文件的 SHA、长度和 mode 前后相同。closed-v1 保留已关闭 pane 的 provider capture，活终端数为零；实际历史 Next/Previous 按 UTF8 字节游标替换 8 KiB 文本，旧页不累积，无替换字符，Previous 恢复原页，未自动连接后端。

第三个本机命名空间经原生确认 Stop 后，其 task/shell 消失，endpoint 撤销且 disabled 为 true。无关远端和本机任务保留同一 PID/startTicks、daemon 和 instance，心跳增加，供应商 fixture 仍只有一次 `turn/start`。本轮被停止目标为 `/dev/pts/1`，两个无关任务为不同 devpts 下的 `/dev/pts/0`；不把本轮目标 Stop 冒称同名 TTY 冲突验收，也不为 2026-10-10 原事件补造因果证据。

原生 Ctrl+Q 正常退出 A（exit0）后，远端与本机任务继续，fixture 的相同 turn 保持运行且心跳增长。使用完整原字节 `desktop-21c` 镜像重开，实际选择并 attach 原远端 terminal/chat，终端界面心跳更新。随后对记录的 Electron 主进程核对 startTicks 并发送 SIGKILL，B/本机 task 与 instance 仍相同，重新打开界面再次 attach 原会话，无重复 prompt。旧 CDP 端口的 LISTEN/不接受连接问题单独留存，改用新的测试端口完成观察，没有向未知 owner 发信号。

上述 chat 使用生产 resolver/stdio 路径上的受控 Codex 协议进程，证明 Superset 的传输、journal 和进程所有权行为；没有真实供应商认证，不等同于真实 Codex/Claude 工作完成，也不代表物理 Mac。

本机原长终端也经实际界面恢复为同一任务；在 Local 连接活跃时选择已停止的另一个数据命名空间，原 workspace 和新建 session 控件随断开清除，未自动连接或启动新后端。Electron 主进程另一次 SIGKILL 前记录的 SSH master 随后消失，control socket 被删除；wrapper 留为 PID1 的 zombie，单独标为已退出且未回收，不能记为仍在运行或完全 reaped。

最终 `2217b95f5` 在独立新 B/home/身份和完整新 Desktop 镜像实际重走 Attach→Send。新 B `1382737`、daemon `1382754`、终端 task `1383511` 和 Codex 协议 fixture `1383541` 使用最终原字节产物。journal 只有一个 user message，wire 只有一次 `turn/start`；原附件省略提示的 `turnId` 与已接受的真实协议 turn ID 相同，GUI 没有 Zod 错误。上传/下载四份 27 字节 SHA 再次一致。

此新 A 正常 Ctrl+Q exit0、重开 attach、主进程 SIGKILL、再次重开 attach 均完成；B、daemon、task、fixture 的 PID/startTicks/instance 保持，后续终端及协议心跳增长。SIGKILL 后约 0.4 秒的采样尚有 closing SSH master，终端 1 秒周期的计数也尚未增长；后续采样确认 master 消失、control socket 删除，真实重开界面显示新心跳，不把早期采样冒称立即完全退出。

最后按受控 fixture 的结束协议释放原 turn，它仍为原 ID，journal 记录 completed、session idle，原界面显示同一 chat 的最终 message 和合法省略提示。该完成与回放只证明 Superset 的进程/journal 路径，不是实际模型供应商任务验收；TXT 内容仍未提交给 Codex harness。

结束前最后一个 A 正常 Quit exit0。随后仅对已登记的 19 个身份核对 UID/startTicks/自有参数，停用三个自有测试 home，并以正 PID 手动清理 supervisor、B、daemon、SSHD 和 Xorg；没有 negative PGID、未知 PID 或预设开发服务信号。这是测试清理，不作为额外的产品 Stop 验收。root 另查这些 PID，均 absent 或相同 startTicks 的已退出 zombie，没有存活的登记测试任务；13 个登记对象已被 PID1 接管为 zombie，不声称已 reaped，SSH wrapper 的 zombie 另在生命周期观察中记录。数据、包、依赖和证据保留。

清理后既有 Web/API/Postgres/Redis 开发流程再冒烟通过：API 200/database ok、Web sign-in、开发账号/session 与 authenticated dashboard 200。此检查只确认可复用云开发环境未受测试清理影响，不把 Web 开发账号当作新的 Desktop 准入条件。独立普通证据复核两份 Desktop/后端检查点、测试计数、进程状态和最终可见完成结果均与原件一致。

## 外部连接与环境配置

环境草稿新增 `SUPERSET_SSH_HOST`、`SUPERSET_SSH_USER`、`SUPERSET_SSH_PORT` 和 `SUPERSET_SSH_PASSWORD` 要求，保留原可复用 install/start 内容及网络设置。主机/用户名/端口是配置建议；密码值只能由用户在环境设置安全填写，没有写入仓库、脚本、日志或此文档。

用户提供的 Linux 目标在 TCP/SSH 握手之前拒绝 22 端口连接，尚未发送认证材料，不能判断密码是否正确。早期检查时变量尚未注入；用户完成环境设置后，本轮再次检查确认四个变量均已 set，配置元数据的 pending requirements 为零。凭据值未输出；此时 TCP 重试仍得到 ECONNREFUSED。保存草稿和运行时应用分别按实际证据记录，当前仍缺目标的可用 SSH 连通性。该外部连接不影响隔离 Linux OpenSSH/GUI 验证；物理 Mac 与真实供应商认证的持续 turn 仍需实际条件。

## 当前验收范围与剩余条件

| 设计项 | 本轮新增证据 | 仍缺的实际条件 |
| --- | --- | --- |
| A01、A05 | 最新无账号界面、Linux SSH 项目/session/PTY、本机多数据选择。 | 物理 Mac、后台 Git/模型认证与完整目录组合。 |
| A06、A07 | 原字节 Linux GUI 的正常 Quit、Electron 主进程 SIGKILL、原 PTY/受控协议 turn 持续与实际重连。 | Mac Force Quit/原生发行生命周期、真实已认证供应商 turn。 |
| A09 | PTY Node 完整 60/60、daemon Node 33 pass/3 个 Darwin skip；pending Stop 与 failed handoff 回归。 | 物理 Mac 的故障组合；不把所有旧云更新/Stop 竞态称为已覆盖。 |
| A15 | 未注入信号拦截的三个 home 实际 Stop 只结束目标，两个无关任务继续。 | Mac launchd stop/uninstall/repair；旧 11:15 Stop 事件完整因果仍未证明。 |
| A16 | GUI 远端文件编辑/冲突保护、原生附件字节往返与鉴权。 | 标准 packaged GUI、Mac 外部浏览器；TXT 提示并不表示供应商接受 TXT。 |
| A02–A04、A10–A14 | 双 Mac 架构发行 workflow 和完整性门禁、官方 Node 校验、Linux 开发 ASAR 的包内后端/PTY。 | 真正 Mac 原生资源、签名/notary、安装/重启/logout、并发维护与回滚验收。 |

旧矩阵保留其当日范围；上表不是 A01–A16 全部通过的声明。可复用云 install/start 已保存，本机服务开发冒烟已验证；外部 SSH 目标的连接拒绝仍阻止用户主机验收。没有发布后端、创建 release/tag 或部署。

本轮可审阅的已脱敏观察保存在[Linux 证据摘要](evidence/ssh-direct-linux-2026-10-12.json)，包含每份产物的源码范围、测试计数、进程身份和实际 GUI 结果，不包含用户主机地址、密码、私钥或 prompt 原文。
