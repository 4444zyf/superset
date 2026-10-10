# SSH 直连后端：实现与验收记录

日期：2026-10-10。需求与完整验收契约见[设计文档](../design/ssh-direct-backend.md)，原 `main` 的已有行为见[现状文档](../current-state-accounts-remote-sessions.md)。本文记录后续获授权的实现，不把新增能力写回原源码现状。

## 基础阶段

基础版本 `58284bc64` 已提交并推送到 `origin/work`。已实现以下源码路径，桌面与离线导入整合继续在后续阶段交付：

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
| 私有配置或身份被换成 FIFO 后阻塞 | 所有相关 reader 使用 O_NOFOLLOW/O_NONBLOCK 并检查 owner、普通文件及长度；root→UID 子进程设截止与 SIGKILL；真实 Node FIFO 回归先红后绿。 |
| shell PATH 别名绕过 direct CLI 隔离 | 校验 realpath 指向实际可执行文件；异步 login-shell env 合并后再次固定 provider profile、清理旧 token/wrapper。 |
| 完整桌面打包后本机后端找不到 PTY daemon | 从已配置的 host-service 入口定位 sibling bundle；拆开 supervisor 的纯导出与 CLI serve 入口；真实 Electron 本机 session/PTY 验证通过。 |
| 备份失败的目录不计入回收、挤掉最后完整快照 | 创建目录时即记录 building 状态；回收区分完整与未完成快照并保留最后完整备份；真实 SQLite/WAL 与恢复两项 Node 回归通过。 |

截至基础阶段已实际执行：direct-connection 47 项 Bun 测试及类型检查；SSH watchdog 3 项真实 Node 测试；host 端口 18 项真实 Node 测试；direct/PR 77 项定向测试；chat-runtime 241 通过、2 项供应商 live 测试跳过；terminal Node 50 通过、2 跳过；shared/chat/host 类型检查；最新 host bundle 构建。安装器及 builder 50 项测试通过，并完成类型和 scoped Biome 检查。计数是各自命令的结果，不汇总为一个重复计算的总数。

## 实际运行证据与边界

基础 checkpoint 后的候选标记竞争、FIFO 阻塞、UID 子进程截止、PATH 别名与 builder import smoke 问题均已修复并通过独立复验。安装器和 builder 最新 54 项测试通过，真实 Node SQLite 两项通过；本机 FIFO 的一项真实 Node 回归通过。新增 Node suites 已注册为 Turbo task，并与 Bun tests 一起进入 CI。阶段提交不是发布验收通过。daemon `auto-update defers when live sessions exist` 的失败已使用未改基线复现，基线允许 live fd-handoff 的实现与旧测试期望不一致；完整 daemon suite 不记为通过。

Linux cloud 采用隔离的普通 UID 后端、真实 OpenSSH sshd、真实 PTY、Electron 与 CDP，未操作用户机器。现有证据目录为 `/workspace/.cloud-onboarding/superset/runtime-verification/`；本机进程退出/复连的检查记录在 `/tmp/superset-local-unix-persistence-check.json`。

- `ssh-unix-proof.json`：真实 SSH streamlocal 请求成功；关闭 A 转发后 B 仍响应。
- `orphan-unix-proof.json`：A 被 SIGKILL 后其 SSH listener 消失；B 前后 PID 相同。
- 本机 Unix 链：真实客户端进程退出后 PTY 心跳仍增长，新客户端连接同一 terminal，终端 WS attached；显式 Stop 后数据保留。
- 完整构建的 Electron UI 已验证无账号进入、添加 SSH、远端 session/terminal；强制关闭 A 的 SSH master 后自动重连到同一 PTY，断线期间写入控件禁用；正常关闭 A 后 B 的同一 PTY 心跳继续，重开 A 后连接配置仍在。最新修正的本机入口也已实际创建 session/PTY。最终项目、端口与退出闭环仍在检查。
- 早期一轮心跳后来结束，原因未确定；新的同一远端 PTY 监测超过 337 秒未复现。不能将结果表述为无限运行证明。
- installer 的两项真实 SQLite 试验使用 Node 内置 SQLite 注入适配；生产 Darwin release 的 better-sqlite3 原生驱动尚未验证。SSH 完全失联时可能遗留 incoming 暂存目录；跨 ABI/schema/PTY bundle 的版本拒绝自动激活，尚未实现停机迁移。

## 验收矩阵

| 编号 | 当前可证明范围 | 尚待验收 |
| --- | --- | --- |
| A01 | 无账号桌面入口与早期真实 Electron 证据 | 最终整合源码 GUI 重跑。 |
| A02 | 全部签名安装/打包源码、故障与完整性测试 | 真实无开发工具 Mac 的完整发行安装。 |
| A03 | 普通 UID/受控 home 与 provider 隔离源码 | 无 GUI 的 launchd、后台 Git/HTTPS/模型认证。 |
| A04 | arm64/x64 构建与原生 smoke 门禁 | 两种真实 Darwin 架构的签名产物及运行。 |
| A05 | 本机真实项目/session/PTY；早期 SSH UI session | 最终 UI 的远端 clone/import、cwd 与目录检查。 |
| A06 | 真实 Node 客户端退出/复连；SSH 强杀后 B 同 PID | 最终 Electron 关闭/重开、真实 Mac Force Quit。 |
| A07 | 持久 chat 接受、恢复与 lifecycle 测试 | 真实供应商已认证 chat turn 的两机持续执行。 |
| A08 | 持久操作及 stale generation 回归 | 最终 UI 断线丢失响应并对账。 |
| A09 | daemon 保留/采用与 supervisor 恢复源码 | 完整故障组合；daemon 全套有失败待诊断。 |
| A10 | 独立 job/disabled 状态源码 | Mac 重启、睡眠、用户 logout。 |
| A11 | 锁、身份隔离、事务与并发边界测试 | 两台 A、两 OS UID 的实际并发安装/回收。 |
| A12 | 私有端点、pins、generation、SSH 安全配置与端口回归 | 真实 Mac host-key 变化及完整 UI 提示。 |
| A13 | busy/drain/冻结、兼容性拒绝测试 | 真实活跃 vendor chat/审批等待的 launchd 更新。 |
| A14 | 上传故障、持久恢复、回滚与提交丢失测试 | 真实 Mac 原生 SQLite 备份、migrations 与回滚。 |
| A15 | 本机 explicit Stop 实证与远端控制测试 | Mac job 的 stop/uninstall/repair 实际行为。 |
| A16 | 真实 HTTP/WS 端口 mux；本机终端 WS | 最终 GUI 文件/Git/附件/远端端口闭环。 |

尚未发布或部署签名后端、未生成/使用生产签名私钥。发行流程需要发布者提供私钥并在客户端独立嵌入公钥，见[安装运行说明](../../packages/direct-install/README.md)。Linux 验证不替代上述 Mac 验收。
