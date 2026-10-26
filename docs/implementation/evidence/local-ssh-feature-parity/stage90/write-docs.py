from pathlib import Path
root=Path('/workspace/superset');p=root/'docs/implementation/local-ssh-feature-parity-2026-10-14.md';s=p.read_text();assert '## 阶段九十：' not in s;s+='''
## 阶段九十：原浏览器导入提示条与固定关闭记录（2026-10-26）

产品1e140e216直接复用原ChromeImportBanner，提取其第一可用来源查询为useBrowserImportSource，legacy周边主体/查询/首来源映射保持。新Workstation只在导入能力可用、提示尚未关闭时发现来源；替换或移除API立即不展示旧来源，旧异步回复不覆盖当前结果，读取失败不展示无效入口。检测只读原目录/来源元数据，不读取或导入历史内容。点击提示条打开阶段八十九的同一个窗口级原导入Dialog，仍由明确Import按钮发起实际写入。

关闭复用原allowlist中的browser-import-banner-dismissals-v1与唯一browser-import-banner ID，不新增localStorage键、DB、迁移、IPC或RPC合同。原ImportHistoryDialogView只有实际写入数据时才调用onImported，工作站将其接回原全局关闭记录；Cancel、空结果或失败继续保留提示。原组件、导入分支、原关闭store/allowlist及主进程/preload/服务/发布路由字节保持。原始key的写入在本功能中始终只用固定ID，有界于一个关闭时间记录。

回归155项/3719断言/19文件、桌面类型、17语言严格编译、插件与AST/字节核对通过。新测试包括元数据发现、来源替换的晚回复、断开与读取失败，以及实际设置Dialog触发的成功/取消/空/失败对关闭状态的区别。两次类型/测试设置错误（renderHook初始props推断、替换时遗漏局部initialProps）保留日志，修复后完整合跑通过；不是产品行为红灯。Biome长目录参数一次报告文件不存在，切到实际组件目录执行后格式/检查通过；未隐藏测试失败。

旧5dcb编译实窗已在两份自有来源存在时复现提示条数量0≠1，截图已查看。新编译本地/拥有loopback SSH两端均退出0：实际发现Google Chrome并显示原提示条，高37px；打开原来源列表只有一个form与两个profile，Cancel后提示仍在，来源历史尚未写入。本地从提示条明确Import202条后提示消失；SSH明确点击Dismiss，记录保持0条，再从菜单仍能打开导入并Cancel。随后两端原window.open新窗格、查找/导航/缩放/DevTools与正常关闭重开通过，提示均未再出现；本地202条及IDs/计数保持，SSH仍0条，三个来源文件SHA256逐一不变。固定关闭记录只有一个时间键。检测/导入来源是新建拥有XDG中的Chromium格式合成夹具，非用户Chrome、活动WAL或真实Keychain。

原HTTP终端本地PID179885/executiond90aada9-8179-4c8f-9148-3d14e8f2d98a，SSH PID183409/execution4bc805d3-2e91-4119-91c5-d89f018b589e，前后身份与cwd保持；SSH有20次原恢复采样。两端HTTP服务通过真实Ctrl+C结束，拥有profile进程和Xorg均0。匹配appPath=/workspace/superset/apps/desktop、renderer=file:///workspace/superset/apps/desktop/dist/renderer/index.html；本地main/renderer端口36753/44697，SSH38077/33071。运行异常数组为空，不等于没有Chromium/DBus诊断。

构建明确退出0后冻结，2205文件manifest SHA2569cbe4606dda4d4b47038667910eecaee173c641cb4b1b11226e77aea3d42fea4，结束后全部文件和72个验收mjs一致，CLI仍f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb。未执行Actions、CLI重建、安装包或后端发行归档。实际查看旧缺失提示、本地提示与原Dialog、SSH重开后无提示但菜单导入仍可用四张截图；其余捕获不混称查看。最新完整终端滚轮/剪贴板原生回归仍是阶段八十九的同源终端实现，本阶段合跑相关单测与原PTY生命周期，没有宣称在新编译上重跑四个完整终端套件。真实供应商Agent、外部SSH、实体Mac触控板/剪贴板及Keychain/FDA仍未原生验。[阶段九十证据](evidence/local-ssh-feature-parity/stage90)。设计模式、rightPane、聊天/任务URL策略、浏览器CLI桥及其他功能继续补齐，整体目标未完成。
''';p.write_text(s)
p=root/'docs/design/local-ssh-feature-parity.md';s=p.read_text().replace('截至阶段八十九的工作清单','截至阶段九十的工作清单').replace('阶段八十至八十九接回主页','阶段八十至九十接回主页').replace('及显式历史/Cookie导入。设置','及显式历史/Cookie导入与原提示条。设置').replace('banner、设计模式、rightPane、聊天/任务URL策略、浏览器CLI桥及其他功能仍在进行','设计模式、rightPane、聊天/任务URL策略、浏览器CLI桥及其他功能仍在进行').replace('最新源码、精确验证范围与失败记录见[阶段八十九](../implementation/evidence/local-ssh-feature-parity/stage89)','最新浏览器源码、精确验证范围与失败记录见[阶段九十](../implementation/evidence/local-ssh-feature-parity/stage90)').replace('其余工具/设置/CLI桥待补','其余工具/设置/CLI桥待补').replace('阶段七十三至八十九接回导航','阶段七十三至九十接回导航').replace('阶段八十至八十九接回私有SQLite、原设置/菜单导入与共享弹窗；banner和其他设置继续补齐','阶段八十至九十接回私有SQLite、原设置/菜单/提示条导入与共享弹窗；其他设置继续补齐');s+='''
阶段九十接回原ChromeImportBanner，元数据发现/晚回复隔离与原固定关闭记录复用，成功导入或明确Dismiss后隐藏；取消/空结果/失败不隐藏。1e140e216通过155项/3719断言、类型、17严格语言、插件和原代码核对。真实本地提示条导入202条、SSH明确关闭而保持0条，Cancel/菜单可用、原新窗格及正常重开后的隐藏/记录持久化、三来源文件不变、原PTY/cwd/20次SSH恢复通过。同一2205编译文件与72脚本复核、CLI不变，无Actions/打包。最新完整终端原生仍按阶段八十九范围，实际供应商Agent/外部SSH/实体Mac未验；其他功能继续。[阶段九十证据](../implementation/evidence/local-ssh-feature-parity/stage90)。
''';p.write_text(s)
print('Stage90 docs written')
