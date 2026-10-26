from pathlib import Path
import json
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-89');r=json.loads((scratch/'native-summary.json').read_text());assert len(r['terminal'])==2
text='''
## 阶段八十九：原浏览器设置导入入口与窗口级导入生命周期（2026-10-26）

产品5dcb36689从原BrowserSettings提取BrowserImportSettingView，原搜索高亮、可见性、按钮及legacy RPC保留，文案通过品牌占位符复用17种原译文。Workstation设置接回此按钮；菜单和设置共用一个窗口级ImportHistoryDialogView，避免每个窗格各自产生同名checkbox/form。关闭设置父层不卸载导入层，处理中原关闭保护继续有效；独立导入操作也不受主页偏好保存中的disabled状态阻止。来源切换时清理打开状态。没有改主进程、preload、导入服务、历史事务、已发布RPC或持久化合同。

组件回归覆盖实际WorkstationSettings打开、受控未完成的导入、关闭父设置、导入层X关闭被拒、完成后正常退出及旧API隐藏入口。移走窗格内的导入Dialog后，以History+Screenshots保持并列弹窗回归的实际覆盖：临时恢复重复key时测试失败，恢复唯一key后通过。临时探针的路径/Bun设置错误未作为行为红灯。最终相关与终端回归148项/3668断言/18文件、桌面类型、17语言严格编译、插件和新代码检查通过；AST核对原设置行除品牌/回调外一致，legacy其余主体及导入View/服务/存储/路由字节保持。[阶段八十九证据](evidence/local-ssh-feature-parity/stage89)。

旧6faad编译实窗从More options滚到Browser settings，实际只有主页/链接，没有Import…，在按钮数量0≠1处预期失败，截图已查看。新编译本地/拥有loopback SSH均完整退出0：原按钮数量1；设置与导入两个标题同时显示，真实滚轮滚回父设置的X后实际点击关闭父层，原来源选择和唯一导入表单仍保留。实际读取新建的两份自有Chromium格式来源，导入202条跨批记录，菜单再次打开同一窗口级表单并Cancel不改变数据；正常关闭重开后私有SQLite仍有202条。来源3个文件逐一SHA256不变。来源是独立XDG下的合成数据，非用户浏览器或活动WAL；不自动导入历史。处理中关闭保护的持续等待由受控组件测试证明，原生流程是在关闭父层之后点击导入，不混称为原生慢速导入取消测试。

两端同时通过原基础浏览器工具、查找/导航/弹窗/重开与拥有HTTP的DevTools检查。SSH先执行20次原恢复采样。HTTP终端本地PID159351/execution56322e99-a0f6-481b-b1cf-0eccf8646ede，SSH PID162929/executiond50ca9e7-f089-42d3-af88-96c1729163c5，前后执行号/PID/cwd保持，HTTP服务通过真实Ctrl+C结束。匹配appPath=/workspace/superset/apps/desktop、renderer=file:///workspace/superset/apps/desktop/dist/renderer/index.html；本地main/renderer端口43913/45269，SSH36979/39747。渲染运行异常数组为空，不等同所有Chromium/DBus日志无诊断。

本轮还重跑用户重点的终端功能。初版四场景runner在本地滚轮通过后，SSH普通历史的数值断言失败；实际查看前/后截图，首行确实由172上翻到169。初轮未保存滚动条数值，不能事后推断其精确初值。相同编译增加只读观测后SSH完整通过，滚动条top420→414。夹具a773320c7随后等待滚动条已渲染，以及单次上/下滚轮后的实际渲染响应，保留首个采样和完成采样；没有额外重发滚轮、增加等待上限、放宽方向/无输入断言或修改产品。最终四场景均通过，原失败与诊断记录一并保存。

最终本地/SSH均覆盖普通历史双向滚动、无鼠标TUI完整重绘后客户端回看、反向/小幅/大幅滚动和Esc均不注入方向键；真实拖选FIRST SCREEN 中文并系统复制一致，只读回看收到系统PNG paste但远端附件前后为空。保存的stock偏好仍不发方向键；原生SGR上下报告、legacy较大坐标原始字节与SGR pixel坐标、重挂载不注入输入均通过。独立剪贴板两场景覆盖中文/Emoji键盘和菜单复制、多行括号粘贴、真实图片/文件路径、重挂载后OSC52；两SSH套件各20次原窗口恢复，运行异常数组为空。此处是raw-mode TUI协议夹具，不是真实供应商Agent认证。

源码构建明确退出0后才冻结/运行：2205文件manifest SHA2567d61733cef2f07896427f613373d00d6afc4ab4c60de56e529c01521fcde0ac4，所有原生运行后逐文件保持。浏览器及初版终端的71脚本按初始快照核对；诊断观测/等待改动发生在前轮完全结束后，最终终端71脚本按新快照核对。CLI仍f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb。未执行Actions、CLI重建、安装包、后端发行归档或共享DB迁移。已实际查看旧设置、本地双Dialog、SSH父设置已关闭及本地回看复制粘贴、SSH初轮普通滚动前后截图；其余是否查看按后续证据记录补充，捕获不混称全部查看。实际供应商Agent、外部SSH、实体Mac触控板/Keychain/FDA/剪贴板未验证。

本轮也按已有阶段记录和当前组件修正功能清单中15行过期状态，包含已接回的文件操作、Git、项目字段/脚本及Agent配置；这是既有证据的整理，不代表本轮重测全部功能。banner、设计模式、rightPane、聊天/任务URL策略、CLI浏览器桥及其余原版功能继续补齐，整体目标未完成。
'''
p=root/'docs/implementation/local-ssh-feature-parity-2026-10-14.md';s=p.read_text();assert '## 阶段八十九：' not in s;p.write_text(s+text)
p=root/'docs/design/local-ssh-feature-parity.md';s=p.read_text();a=s.index('## 2026-10-25 当前重点状态');b=s.index('\n## 验收原则',a);s=s[:a]+'''## 2026-10-26 当前重点状态

用户强调的滚轮/触控板输入保护和终端复制粘贴已实现。阶段八十九在5dcb36689源码编译上独立回归本地与拥有的loopback SSH：历史上下翻动、无鼠标TUI回看不注入方向键、保存的stock偏好、SGR/legacy/pixel切换、中文/Emoji复制、多行括号粘贴、图片/文件路径及重挂载后OSC52通过。两个SSH套件各含20次窗口恢复。初轮数值观测失败、截图和只读诊断已保留；最终夹具等待实际渲染并保留前后数值，不重发滚轮输入。真实供应商Agent、外部SSH和物理Mac触控板/剪贴板仍未实测。

内部浏览器已接入现有工作区标签/分屏，复用原运行时、工具栏、导航/查找、历史SQLite、所属SSH工作区的localhost转发、当前图标与V2持久化。阶段八十至八十九接回主页/终端URL与端口策略、原工具菜单/DevTools、设备预览、历史搜索/清空、浏览数据清理、下载、截图/系统图片剪贴板及显式历史/Cookie导入。设置和菜单共用一个原导入弹窗，关闭父设置后继续保留，真实两端202条导入和正常重开通过。Mac Cookie/Keychain/FDA尚未原生验证；不导入密码数据库。banner、设计模式、rightPane、聊天/任务URL策略、浏览器CLI桥及其他功能仍在进行，不宣称整体对齐完成。最新源码、精确验证范围与失败记录见[阶段八十九](../implementation/evidence/local-ssh-feature-parity/stage89)，历史验证见各阶段实施记录。
'''+s[b:];s+='''
阶段八十九接回原BrowserSettings导入行，菜单/设置共用窗口级原ImportHistoryDialogView；关闭父设置保留导入和处理中关闭保护。5dcb36689通过148项/3668断言、类型、17严格语言、插件与原代码核对；本地/拥有SSH实窗均从原菜单进入设置、导入202条并保持来源文件、取消/正常重开，原PTY/cwd保持。终端数值观测失败与截图不一致的初轮及只读诊断保留，夹具a773320c7增加渲染状态等待/前后数值且不重发输入后，最终本地/SSH滚轮和独立剪贴板四场景通过；同一2205编译文件及CLI保持。15行过期清单状态按既有源码/证据更新，其余功能继续，实际供应商Agent/外部SSH/实体Mac未验。[阶段八十九证据](../implementation/evidence/local-ssh-feature-parity/stage89)。
''';p.write_text(s)
print('Wrote stage89 documents')
