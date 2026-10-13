# SSH工作窗口恢复实现与验收

状态：实现完成；原版布局与新图标的原生双架构DMG完整验收通过。版本1.37.6，分支`release-ssh-workspace-restore-1.37.6`，基于`release-ssh-performance-1.37.5@ed4e9964794f9a09887a1a7e25eb5e02f165b31e`。设计见[窗口恢复](../design/ssh-workspace-window-restore.md)。

## TDD记录

先加入行为失败测试，再实现最小能力，随后补充真实PTY和界面生命周期检查。红阶段的缺模块检查仅证明设计尚未实现，关键危险边界另有实际行为失败记录；并非用缺模块替代竞态验证。

| 行为 | 红阶段观测 | 实现后检查 |
| --- | --- | --- |
| 启动只连接既有后端 | 原connect调用了installer一次 | restore-existing缺endpoint不上传/安装；不同模式在途请求拒绝合并 |
| 条件接回和后续写入 | 缺executionId、条件被忽略 | 原标识可接回；真正新PTY拒绝旧subscribe/input/resize且未收到旧输入 |
| handoff保留身份 | 快照丢失executionId | 序列化测试和真实fd handoff核对原PID与executionId |
| daemon不可用 | 缺权威恢复查询 | 返回unknown，不将active DB行当作存活或空列表 |
| pending操作只读 | 缺inspectPending，旧reconcile有清理作用 | 检查前后journal相同，仅query，不重放mutation |
| 延迟保存与导航 | 同ID renderer reload旧写入覆盖新状态 | owner epoch、CAS和导航修订阻止迟到写入；Forget推进revision |
| 未识别schema | 普通保存覆盖schema99记录 | 保留原记录，只有明确Forget可清除 |
| chat恢复 | 保存的session被列表首项覆盖 | 受控session不发送prompt；回调改变不重复打开stream |
| 终端UI | 使用普通attach且忽略原执行 | 仅匹配attached三元组后启用输入；错误/exit撤销输入 |
| 多窗格骨架 | 离线时零个窗格 | 三个窗格、两层比例、焦点和引用保留且无普通connect/mutation |
| 本地工作区兼容 | SSH视图捕获误接管local | local继续原有打开路径，不捕获SSH布局 |
| 网络重试 | 无重试，立即暂停 | 注入wait快速核对1/2/4秒及最多4次既有后端连接 |
| 权威已结束执行 | 相同executionId且alive=false显示interrupted | 返回exited；缺失执行才显示interrupted |
| 文件耐久性 | 新功能无文件存储 | 写入提交后SIGKILL实际writer，重开文件恢复完整快照 |

桌面定向套件63项、daemon单元196项、direct-connection68项、安装86项已通过；后续增加的模式隔离、旧daemon、权威结束状态独立检查通过。真实Node套件验证替代PTY及host DaemonClient/实际handoff；不会将Bun不支持的物理PTY套件失败写成全套通过。新增文案覆盖17种语言，严格i18n检查通过。最终冻结源码的检查结果另列。

## 真实界面与限制

使用本分支的实际Electron源码构建、独立XDG profile、本机独立OpenSSH端口和私有后端目录，鼠标/键盘添加SSH目标、新建工作区和三个PTY、输入心跳命令、重命名Claude/Codex/OMP和调整比例。没有连用户机器，也没有三个供应商CLI凭据；名称是用户标题，验收范围为终端持久性和窗口恢复。

已有一次20样本完整Quit/ForceQuit与窗口Close重开验证，保存引用、布局和焦点一致；另测离线后重试、host-service进程变化且daemon执行不变、一个原shell明确exit而另外两个继续。分屏反复拖动、停留和120ms主线程停顿压力未产生renderer错误。调试脚本曾选错Workspaces按钮或在窗口关闭后使用旧调试上下文，失败记录保留，修正为真实控件和正确实例重附加后复测。

源码构建的20样本骨架指标与接回观测保留为开发环境结果，不当作Mac DMG证明。`authenticatedToAttachedUpperBoundMs`是认证后到CDP观测三个attached的上界，包含调试重附加/轮询；不声称是分项输出绘制时间。正常Quit通过Electron主进程`app.quit`模拟菜单生命周期，ForceQuit是SIGKILL拥有的客户端PID，Close是原生BrowserWindow.close；没有直接修改DOM或恢复store来制造结果。

原生DMG将另行进行同样20样本与异常场景；正式版本未发布，Apple Developer ID和公证仍未配置。


## Linux源码构建最终回归

1.37.6源码构建使用20个独立客户端退出/启动样本，其中一次SIGKILL；每次核对三个原terminal ID/executionId、工作区分屏树、标题和焦点一致。另完成窗口Close/重开、SSH监听器停用后离线重开/明确重试、host-service SIGKILL/自动监督重启但原daemon执行不变、终止一个shell后两活一结束、三个工作区标签恢复、daemon SIGKILL后禁止接回/respawn，以及header-only真实WebSocket认证。URL携带PSK而无header返回401；header认证只接入指定原执行。

| 指标（20样本） | 中位数 | P95 | 最大 |
| --- | ---: | ---: | ---: |
| renderer就绪→布局可见 | 95.10 ms | 111.80 ms | 121.80 ms |
| SSH认证完成→三个attached观测上界 | 148.32 ms | 182.66 ms | 186.83 ms |

原始记录与已检查截图：[源码界面证据](evidence/ssh-workspace-restore/source-linux)。这是提交前的本地工作树开发环境测试，包含实际执行心跳，不能冒充冻结SHA的Mac发行物，也不代表真实供应商CLI或所有网络。新建工作区时列表未渲染的回归也有实际RED/GREEN测试，直接使用创建响应打开保存的标签。

手动断开后恢复另有行为RED/GREEN：主进程已经重新允许自动连接，但renderer仍持有旧autoConnect=false而拒绝接入。成功恢复事件现在重新读取主进程的可信视图决定；真实界面验证断开、重开保持暂停、明确Retry后接回原三个执行并保存autoConnect=true。目标host编辑测试也验证暂停且不覆盖旧视图。

首轮原生ARM的实际DMG通过了签名资源、SQLite/PTY和完整SSH安装，但GUI脚本重命名时失败：Mac的CDP Cmd+A未触发全选，得到TerminalClaude等标题。该轮不能作为恢复生命周期验收通过；脚本改为随真实按键传递Chromium编辑命令selectAll，继续核对准确标题并复测。

实际行为RED/GREEN另覆盖缓存租约：restore-existing仍重新确认维护状态，frozen不能绕过暂停边界。普通显式健康租约复用保持零网络路径。

界面启动阶段显示正在重连，连接/核对期间禁用重复Retry；恢复已暂停/取消时即使存在旧健康descriptor也不向窗格传递连接。退出后的任务进展再增加独立证据：客户端进程已结束期间，通过只读条件订阅等回放结束，然后记录新收到的live输出字节、原executionId与PTY PID；这区别于只看到旧缓存文本。

原生复测还发现验收脚本在键盘比例保存完成前采集了旧0.5，而Quit正确刷新成0.45；修正为真实拖动到0.37并等待主进程提交后采集基线。另有实际RED/GREEN回归：move/up在同一渲染批次时旧闭包会把最终比例写回0.5，现按最后指针比例提交，覆盖快速拖动结束及cancel。

最终3样本源码回归（包含63项单测后的快速拖动修正）完成全部异常场景及关闭客户端期间的新live输出检查，记录见[closed-output-check.json](evidence/ssh-workspace-restore/source-linux/closed-output-check.json)。20次原生发行物测量独立进行；不会将3样本代替20样本性能统计。

## 1.37.6第三轮原生结果（源码a333f838d）

[运行38389861774](https://github.com/4444zyf/superset/actions/runs/38389861774)：Intel实际DMG的20次退出/重开、窗口Close、主动断开/重试、离线重试、host重启而原执行不变、两个存活一个结束/中断占位、三个工作区标签和daemon丢失均通过；只是PTY任务，不是供应商CLI验证。骨架中位数153.00ms、P95 181.50ms、最大234.90ms；认证后到三个attached观测上界中位数295.07ms、P95 477.58ms、最大508.23ms。P95目标达到，但不承诺每次骨架200ms以内。

ARM在比例基线采集处失败：采集到旧0.5，Quit刷新后恢复为实际修改的0.45；没有发放该架构的已验证DMG。修正后的下一轮使用真实非默认比例拖动、等事务提交、并补上退出期间新输出验证。Intel第三轮记录保留在[原生证据](evidence/ssh-workspace-restore/native-x64-third)，不能用于声明第四轮全部通过。

## 1.37.6第四轮原生结果：布局复用之前

[运行38394518343](https://github.com/4444zyf/superset/actions/runs/38394518343)，冻结源码 `02309ed5474fbfde3efe5469262c28c0543bd106`：ARM64 与 Intel 的实际 DMG 均通过 SQLite/PTY、SSH 自动安装与20次退出/重开，以及所有异常生命周期。每个架构另记录60条客户端进程已关闭后的原 PID/executionId 新输出证据。原始证据：[ARM64](evidence/ssh-workspace-restore/native-pre-reuse-arm64)、[Intel](evidence/ssh-workspace-restore/native-pre-reuse-x64)。

| 20样本指标 | ARM64 中位数 / P95 / 最大 | Intel 中位数 / P95 / 最大 |
| --- | --- | --- |
| renderer就绪→布局可见 | 52.70 / 63.40 / 64.20 ms | 158.50 / 245.90 / 308.20 ms |
| 认证→三个attached观测上界 | 117.47 / 133.66 / 135.06 ms | 338.88 / 661.14 / 748.63 ms |

Intel 本轮骨架 P95 超过200ms，不能声称该目标在双架构全部达到。此轮 UI 仍是复用原版组件之前的版本；其 DMG 和数据不能当作新版布局的验证结果。

## 复用原版布局与能力

按[复用设计](../design/ssh-workspace-upstream-ui-reuse.md)接入原版标签栏、窗格/分屏引擎、侧栏、代码编辑器、终端构造器/搜索和聊天 Markdown。新旧工作窗口公用端口控件及原有操作。删除自制 PaneTreeView 与专用侧栏样式，保留 main SQLite 与严格恢复协议。

真实源码测试中曾发现终端容器留白未被 FitAddon 计入，导致内容超出窗格底部；把留白放到 xterm 自身后复测通过。文件验证脚本也改为等待初始文件/Git读取结束后实际点击可用文件按钮。原版分隔条有像素取整，测试核对非默认实际比例并用主进程提交结果作恢复基线，不把脚本预设比例冒充库的实际输出。

源码3样本已完成远端代码编辑/保存/重读、终端搜索、侧栏收起与全部恢复异常场景。最终20样本及新版原生DMG另行记录，不能用之前版本的证据代替。

最终新版源码窗口20个退出/启动样本通过，另有真实窗格拖拽、原版搜索、侧栏折叠、远端文件写入/重读、窗口Close、主动断开/重试、离线、host重启原执行保留、部分执行结束、三个工作区标签和daemon丢失检查。60条客户端关闭期间的新输出记录均保留原PID/executionId。证据：[新版源码窗口](evidence/ssh-workspace-restore/source-linux-upstream-ui)。这是本地工作树、Linux真SSH/PTY和实际CDP输入，不代表macOS发行物或供应商CLI。

| 新版源码20样本 | 中位数 | P95 | 最大 |
| --- | ---: | ---: | ---: |
| renderer就绪→布局可见 | 129.15ms | 168.60ms | 244.50ms |
| 认证→三个attached观测上界 | 234.69ms | 291.12ms | 311.04ms |

混合分屏拖拽测试曾选中内层垂直分隔条而错误地按外层水平轴测量；定位为外层分组直接子分隔条后，实际非默认比例和重开后的完整树一致。此测试错误不作为产品性能故障统计。

本轮64项Workstation行为测试、121项原版panes测试、22项终端共享能力测试通过；desktop类型检查、构建、17语言严格编译通过。既有restore主进程、daemon和安装协议测试记录仍保留。新版原生包验收结果待下面独立记录。

## 原版组件：双架构原生通过（新图标之前）

[运行38402982466](https://github.com/4444zyf/superset/actions/runs/38402982466)，冻结源码`98acfb5b33ecebbf059c517c36975150cbc5e8cf`。两个架构的实际DMG均通过完整验收，每架构20次退出重开与60条退出期间新输出记录；包括真实远端代码编辑/保存/重读、搜索、侧栏折叠、窗格拖拽、全部恢复异常场景和原生SQLite/PTY。原始记录：[ARM64](evidence/ssh-workspace-restore/native-upstream-before-icon-arm64)、[Intel](evidence/ssh-workspace-restore/native-upstream-before-icon-x64)。

| 20样本指标 | ARM64 中位数 / P95 / 最大 | Intel 中位数 / P95 / 最大 |
| --- | --- | --- |
| renderer→布局 | 77.65 / 95.10 / 95.60 ms | 140.50 / 156.70 / 167.80 ms |
| 认证→三个attached观测上界 | 209.11 / 242.93 / 252.11 ms | 240.32 / 298.94 / 312.27 ms |

此轮两架构骨架P95均低于200ms。图标随后按用户要求重新设计为折带S，新图标发行物的冻结源码为`5f57715ff03a6cb984c04cde0243d297872654ff`，其验收独立进行。此轮旧图标截图不作为新图标的证明。

## 新图标实际DMG：双架构验收

[运行38406074334](https://github.com/4444zyf/superset/actions/runs/38406074334)，冻结源码`5f57715ff03a6cb984c04cde0243d297872654ff`。双架构实际DMG均通过完整验收。每架构20次退出/重开、60条客户端关闭期间原执行的新输出以及全部异常生命周期通过；远端代码编辑/保存、终端搜索、原版侧栏和窗格拖拽均通过。此测试使用心跳PTY，不冒充真实供应商Agent验收。原始证据：[ARM64](evidence/ssh-workspace-restore/native-final-arm64)、[Intel](evidence/ssh-workspace-restore/native-final-x64)。

| ARM64 20样本指标 | 中位数 | P95 | 最大 |
| --- | ---: | ---: | ---: |
| renderer→布局 | 118.95ms | 195.80ms | 199.30ms |
| 认证→三个attached观测上界 | 367.74ms | 561.05ms | 588.35ms |

源码图标导出、实际侧栏/About截图与打包资源分别验证；没有以侧栏截图代替真实Dock截图。已验证[ARM64下载](https://github.com/4444zyf/superset/actions/runs/38406074334/artifacts/11819389283)，14天保留。

Intel 20样本renderer→布局中位数/P95/最大为339.80/656.10/780.30ms；认证→三个attached观测上界为725.03/1325.50/1725.54ms。Intel本轮未达到骨架200ms的性能目标，功能验收通过不等于性能目标通过。已验证[Intel下载](https://github.com/4444zyf/superset/actions/runs/38406074334/artifacts/11821542454)，14天保留。
