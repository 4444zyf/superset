# SSH工作窗口恢复实现与验收

状态：实现完成；原生双架构DMG验收进行中。版本1.37.6，分支`release-ssh-workspace-restore-1.37.6`，基于`release-ssh-performance-1.37.5@ed4e9964794f9a09887a1a7e25eb5e02f165b31e`。设计见[窗口恢复](../design/ssh-workspace-window-restore.md)。

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

桌面定向套件62项、daemon单元196项、direct-connection68项、安装86项已通过；后续增加的模式隔离、旧daemon、权威结束状态独立检查通过。真实Node套件验证替代PTY及host DaemonClient/实际handoff；不会将Bun不支持的物理PTY套件失败写成全套通过。新增文案覆盖17种语言，严格i18n检查通过。最终冻结源码的检查结果另列。

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
