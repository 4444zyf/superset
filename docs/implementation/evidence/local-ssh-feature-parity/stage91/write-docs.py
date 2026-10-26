from pathlib import Path
root=Path('/workspace/superset');p=root/'docs/implementation/local-ssh-feature-parity-2026-10-14.md';s=p.read_text();assert '## 阶段九十一：' not in s;s+='''
## 阶段九十一：原站点Cookie菜单、键盘选择与窗口归属（2026-10-26）

产品609f68608恢复原Signed-in sites菜单。原getCookieDomains/clearCookiesForDomain主体移入惰性Cookie服务，原router仍用persist:superset、原z.string输入、原排序、返回值/错误与query/mutation；其他所有browser过程保持AST一致。站点数据是当前桌面独立profile的浏览器Session Cookie元数据，跨窗格共享，非SSH机器上另一个浏览器，也不代表真实网站认证状态或密码库。

原SignedInSitesSubmenu提取纯View，legacy wrapper仍调用原RPC；Workstation只在可选siteCookies能力存在时放入原菜单slot。原20行上限、全列表大小写无关搜索、数量提示和onSelect.preventDefault保留。新私有IPC保留原主frame归属检查，域名非空/最大253仅约束新IPC，不收紧旧RPC；Cookie adapter在异步读取完成及每次remove前核对当前窗口/epoch，替换窗口后不继续删除。读取失败显示真实错误/Retry，来源替换/关闭时丢弃旧回复，正在删除时禁用站点项。没有DB迁移、新持久键、host版本门槛或Cookie值读取接口。

原搜索框拦截所有非Escape键，真实焦点单测复现ArrowDown仍停在input，3通过1失败；现在Down/Up进入首/末个可用项再Enter选择，4项通过。原Cookie聚合/leading dot/secure方案/路径/名称与失败、惰性session获取、旧窗口未完成读取，以及菜单上限/键盘/错误Retry/来源晚回复均有回归。最终166项/3772断言/22文件、桌面类型、17严格语言、插件与AST/字节核对通过。Cookie测试夹具补sameSite字段、UI测试路径和键盘测试编辑定位的设置失败日志保留，未作为产品行为红灯。

旧1e140编译的首次含原tools附加流程在进入Cookie测试前遇到DevTools关闭Runtime.evaluate超时，compiled2205逐文件不变，不能归因于尚未编译的新代码。该失败保留并待单独诊断；DevTools截图已查看，body折叠，DOM遍历包含标记不等同截图可见标记。随后Cookie独立基线/新版使用同一scoped流程，保留原导航/查找/window.open/重开/PTy，但不包含该DevTools附加验收。基线实际有28个自有Cookie而capability=false，菜单缺少Signed-in sites，预期失败截图已查看；不把独立Cookie通过当作DevTools超时已解决。

初版609本地真实列表为27域/20可见项，脚本在搜索后对子菜单已关闭的旧元素继续按键，Cookie库显示目标尚未删除。只读事件/菜单状态跟踪进一步记录移入搜索框时焦点回到父menu并关闭子菜单。夹具3230bd16b改为从原触发项先在行内向子菜单方向移动，再横向进入子菜单、纵向到搜索框，核对live state/前后命中并只点击一次；原截图等待后再次确认选中行仍open再Enter。没有重试删除、增加等待上限、强制展开DOM或调整布局，产品编译不变。轨迹脚本一次编辑定位失败而重复使用了前一版夹具，单独记为setup失败。SSH首轮漏转交新增SDK夹具回调，未到菜单测试；181fc037a仅补SSH验收桥转交，本地消费路径不变。

最终本地diagnostic-local-path-609f6和拥有loopback SSH的verified-ssh-bridge-609f6均完整退出0。测试数据由自有guest JS设置两个primary路径Cookie，以及拥有App主进程原生SDK在新profile中设置26个合成secure/HttpOnly Cookie；这是夹具准备，不是用户登录/导入的端到端证明。真实More options→Signed-in sites显示27域但仅20项；键入SITE-24找到初始20行之外的域，Down焦点与live菜单/Enter实际删除该secure/HttpOnly项。再搜索primary域，原X按钮显示2 cookies，实际删除根与/protected两个路径；未选中的other-owned.invalid保持1条。新私有API空域名诊断拒绝且不改变Cookie，非用户UI操作证明。两端正常关闭重开后Native SDK及只读SQLite均为25条，两个已删域仍缺失，无关域保留；不宣称删除事务原子性，原Promise.all失败仍可能部分完成。

本地HTTP终端PID187153/executioncdf622fd-fe96-44fc-8ee6-a289943ed397，SSH PID194257/execution8fb0434d-6d2f-42c6-8d4a-5b33d0f7b8cf，前后ID/PID/execution/cwd保持；SSH有20次原恢复。原HTTP服务真实Ctrl+C结束，所有本轮拥有case进程/Xorg均0。匹配appPath=/workspace/superset/apps/desktop、renderer=file:///workspace/superset/apps/desktop/dist/renderer/index.html，本地main/renderer端口38211/37557，SSH44747/39595。渲染异常数组为空，Chromium/DBus诊断保留。

构建明确退出0后冻结2205文件manifest SHA25617235ac0d8db527cc9b82de7ccc1b3a3377aa5dc25eb5b42adc71171dd075477，全部原生后逐文件一致；最终73个mjs复核。本地版本3230与SSH版本181f之间唯一脚本差异为SSH桥转交，分别保留哈希。CLI仍f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb。无Actions、CLI重建、安装包或后端发行归档；raw profile/DB/私钥不进入证据。实际查看的基线、初轮列表/关闭状态、最终选中行/No matches与SSH重开截图列表见visual-review.json，其余只捕获。最新完整终端四场景原生回归仍按阶段八十九范围，当前合跑相关单测与原PTY生命周期。[阶段九十一证据](evidence/local-ssh-feature-parity/stage91)。

外部SSH环境变量readiness为ready，但配置TCP代理的实际socket连接返回ConnectionRefusedError，未建立隧道、未发送SSH密码或运行远端命令。不能据此称SSH认证失败或403策略拒绝，也不绕过代理；外部SSH、真实供应商Agent、实体Mac/Keychain/FDA仍未验。设计模式、rightPane、聊天/任务URL、CLI桥及其他原版功能继续，整体目标未完成。
''';p.write_text(s)
p=root/'docs/design/local-ssh-feature-parity.md';s=p.read_text().replace('截至阶段九十的工作清单','截至阶段九十一的工作清单').replace('阶段八十至九十接回主页','阶段八十至九十一接回主页').replace('原提示条。设置','原提示条、站点Cookie菜单。设置').replace('最新浏览器源码、精确验证范围与失败记录见[阶段九十](../implementation/evidence/local-ssh-feature-parity/stage90)','最新浏览器源码、精确验证范围与失败记录见[阶段九十一](../implementation/evidence/local-ssh-feature-parity/stage91)').replace('阶段七十三至九十接回导航','阶段七十三至九十一接回导航');s+='''
阶段九十一接回原Signed-in sites菜单，原Cookie聚合/清除服务及发布RPC合同保持，新增可选私有IPC具当前window/epoch保护。修正搜索框Down/Up焦点进入项，原上限20/过滤/数量语义保留，读取失败可Retry/旧来源回复隔离。609f68608通过166项/3772断言、类型、17严格语言、插件与原代码核对。本地/拥有SSH的真实27域/28Cookie夹具完成跨20项搜索、键盘secure/HttpOnly与双路径清除、无关域保留、正常重开25条、原PTY/cwd/20次SSH恢复；73脚本按消费版本复核，CLI不变。首个tools附加DevTools关闭超时仍待单独诊断，Cookie验收不包含其通过声明。配置TCP代理连接被拒，外部SSH尚未到认证；其他原版功能继续。[阶段九十一证据](../implementation/evidence/local-ssh-feature-parity/stage91)。
''';p.write_text(s)
print('Stage91 docs written')
