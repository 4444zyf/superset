# 无账号桌面功能对齐实施记录

状态：进行中，**尚未完成全部功能对齐**。分支 `release-local-ssh-feature-parity-1.37.7`，desktop、host-service、CLI统一为1.37.7，基于1.37.6 `0ad8c05dd`。逐项范围见[功能清单](../design/local-ssh-feature-parity.md)。原版源码存在不算当前界面已可用。

## 第一批：文件与 Git

复用原版 `StageToggleButton`、`CommitForm`、`FilesTabHeaderButton`，并将原版搜索结果行提取为 `FileSearchResultRow`，原 wrapper 保持原点击/拖拽/菜单行为。新的本地/SSH wrapper 使用原 host-service 的 filesystem/git 服务，不复制文件系统或 Git 实现。代码编辑器仍使用原 `CodeEditorSurface`，增加可选命中行定位，不改变原 wrapper 默认行为。

已接入：逐文件暂存/撤销暂存、全部暂存/撤销暂存、仅已暂存范围的提交；文件/文件夹新建、重命名、移动、复制与明确确认的永久删除；文件名和内容搜索、命中行跳转。完整树、多文件标签、回收站、Git全部历史/分支/同步界面等仍在清单中，不能将本批当作完整文件/Git功能对齐。

新操作的工作区、类型和版本能力在主进程检查。`workstationFilesV1`/`workstationGitV1`为新增可选标志，旧后端不会误调用。现有 tRPC 合同保持原样；`direct.execute`枚举新增提交和推送入口。提交复用 main SQLite 意图与后端持久回执，必须使用同一个操作编号查询或恢复；丢失响应仍待核对，不自动重试、不自动暂存其他文件，不宣称跨进程崩溃时供应商执行端 exactly-once。

## TDD 与回归

红绿日志保存在[阶段一证据](evidence/local-ssh-feature-parity/stage1)。入口测试先在缺少操作/按钮时失败；新组件测试最初因模块尚不存在失败。后端提交测试在1.37.6原始 direct router 上因不支持 `git.commit`失败，恢复新路由后通过。首次测试夹具没有工作区、搜索相对路径含`./`的两次测试设置错误已修正，不计作产品缺陷或性能故障。

| 验证 | 当前结果 |
| --- | --- |
| 主进程作用域、兼容与提交未知回执 | 21项通过 |
| 文件入口、编辑与命中行、Git原按钮 | 13项通过 |
| 提交表单双击/快捷键、新草稿、晚回复 | 6项通过（包括IME组合输入） |
| 新建不覆盖、路径逃逸、删除确认、晚回复 | 5项通过 |
| 搜索界限、预览文本、切换与旧后端 | 4项通过 |
| 上述组与renderer safety合跑 | 53项通过，160断言 |
| 真实临时Git仓库、direct回执、原服务集成 | 通过；同编号重试只有一个新提交，未暂存文件保留 |
| 真实临时文件系统、冲突、复制/移动/删除/搜索 | 通过，未构造Superset云API请求 |
| desktop/host-service类型、构建 | 通过；实际界面测试前再核对最终代码 |
| 17语言严格编译 | 通过；4条新增文案全部翻译 |

真实 Electron/SSH 界面验收已增加物理点击、输入、菜单、确认、搜索定位、提交与后端只读核对脚本。当前该阶段的实际界面证据待运行；Linux源码窗口不能替代macOS发行物，尚未生成1.37.7的已验证DMG。后续设置、快捷键、项目生命周期、Agent、插件、浏览器与本地元数据功能仍需继续完成。

### 实际窗口发现的菜单交接问题

真实Electron输入中，新建、保存与内容命中行跳转已走通，但文件菜单选择复制后对话框被关闭。加入菜单选中后不能在旧菜单关闭前打开第二个模态层的回归测试：旧代码失败，新代码通过。现在由原 DropdownMenu 的 `onCloseAutoFocus` 交接给对话框，阻止旧菜单抢回焦点；同时检查当前连接/工作区归属。实际窗口复测仍待记录。

验收脚本也修正了布局数据的 snapshot 层级、首次手动连接没有恢复任务的时序，以及等文件/Git读取结束后点击可用搜索/提交按钮；这些脚本错误不计作产品通过。提交证明改为读取实际HEAD中的文件，避免误把原 `listCommits` 的相对基础分支列表当作全仓库历史。

保存的文本日志仅去除行尾空白；原始与归档SHA-256见 `stage1/log-hashes.json`，测试结果与失败内容保留。

### 仓库 Git 身份与本机设置底座

真实源码窗口已通过新建/保存、命中行跳转、复制/重命名/移动和确认删除；提交因测试后端没有Git作者身份而失败，保留该失败，不假定Superset账号能代填身份。新增版本化 `git.getUserIdentityV1/setUserIdentityV1` 和 `workstationGitIdentityV1`，使用同一Git工作线程和凭据环境读取作者姓名/邮箱，明确保存到当前仓库；不修改其他Git配置，也不调用GitHub/Superset账号API。界面先配置身份再允许提交，晚到查询不能覆盖已保存状态，父组件回调变化不能重复读取或清空草稿。实际界面复测仍待完成。

本机设置使用独立、固定单行、64KiB上限的SQLite存储，CAS防止旧窗口覆盖；复用原字体校验/规范化和文件设置枚举。损坏或未来版本保留原字节、返回安全默认值，Agent原生输入默认关闭且不接受字符串布尔值。此存储尚未接到完整设置界面，不能据5项存储测试声称设置功能已全部完成。文件枚举提取到shared，原local-db继续原名导出，枚举值与SQL schema均未改变。

新一轮桌面相关合跑61项、187断言通过；Git身份/文件/持久提交与工作线程注册表集成5项、24断言通过。后端集成指定源码worker，避免运行本地残留的旧dist worker；最终发行物仍需使用实际打包worker验证。身份与设置新增代码的desktop/host类型检查、17语言严格编译通过。

### 第一批真实源码窗口通过

冻结产品源码 `b6f87adddb874cc2151f8920794db253e82ed571` 的Linux实际Electron窗口通过：物理点击/输入完成新建、代码编辑、内容搜索命中行、复制、重命名、移动、确认永久删除、仓库作者配置、逐文件暂存与提交；读取实际HEAD证明仅所选文件入提交，原未暂存修改保留。还通过3次退出/重开（含强制退出）、9条客户端关闭期间原PID/executionId新输出，以及窗口Close、离线、主动断开/重试、host重启、部分执行结束、三个工作区与daemon丢失等原恢复场景。

[成功截图与原始记录](evidence/local-ssh-feature-parity/source-linux-file-git)，[失败轮次](evidence/local-ssh-feature-parity/source-linux-failures)。复制菜单的问题在同一真实输入路径上先失败、修复后通过；Git作者缺失经界面配置后通过，不使用Superset身份假数据。脚本修正的时序和数据层级错误仍保留。此证据是Linux源码/真实SSH与心跳PTY，不是macOS安装包或真实供应商Agent验证，完整目标仍未完成。

## 阶段二：显示语言、主题与字体

独立偏好库已通过主进程的现有可信窗口检查接入 preload；不读取原账号 SQLite 数据，也不请求云端设置。界面复用原 SettingsRow、SettingsSection、ThemeSwatch、字体选择/数值控制/预览；TypographySurfaceCard 与 FontPreview 提取展示部分，原 wrapper 继续使用原主题和数据源。默认字体对象提取为同一常量，原 hook 继续原名导出。

主题使用原 UI 变量映射、CodeEditorSurface 和终端外观解析器；语言使用原17语言目录和 I18nProvider。终端字体变化更新现有 xterm，复用字体加载后重测量，保持 socket 与 execution；选中复制复用原 installCopyOnSelect，其系统剪贴板回退走本应用可信 IPC。尚未接完系统/自定义主题、文件自动保存/打开方式、退出确认和其余完整设置，不据此宣称外观/设置组已全面对齐。Agent原生输入开关仍默认关闭，未在界面假装已经提供 ACP。

TDD 先记录缺少设置组件、终端外观未接入、丢失回复遇到旧刷新时未重新查询三项失败，再实现：偏好保存只发送一次CAS写；并发编辑阻止，丢失回复只重新读取，不自动再次写入；旧刷新不能回退新revision。48项相关桌面/存储/架构测试、180断言通过，desktop类型、17语言严格编译与 Electron 构建通过。红绿日志与原始/归档哈希保存在[阶段二证据](evidence/local-ssh-feature-parity/stage2)。

增加真实设置窗口脚本：物理输入编辑器/终端字号、切换Light和中文/英文，核对本机SQLite回复、终端字体测量、同execution以及关闭重开后偏好保存。该检查点最初待运行，实际结果见下一节。

### 设置真实源码窗口通过

冻结源码 `7e24cfbe89bad8feabee6f6629437f7fa1bcb9a1`，设置相关产品构建源为 `c55d358c02fbf1a6187d53bffb85bc98488013f8`，后续提交仅修正验收脚本。第12轮 Linux Electron/真实SSH窗口通过：原版字体控件由物理输入保存 editor17px/terminal18px，3个实际DOM终端 renderer 的计算字体为18px；切换 Light、中文与英文，关闭/重开后原偏好回复一致、3个execution一致；远端文本编辑器计算字体为17px。该轮恢复循环只采样1次，不冒称20次性能采样；第一阶段的3次恢复证据继续单独保留。尚无1.37.7 macOS发行物验收。

[设置截图与实际记录](evidence/local-ssh-feature-parity/source-linux-settings)。第8/9轮暴露真实布局问题：原字体预览的最小内容宽度把新表单撑出窗口，756px对话框 scrollWidth1576px，输入框x1679px；限制外层grid和fieldset后scrollWidth756px，输入框x860px，物理输入通过。第10轮脚本未扣除原主题色块的Aa预览文字，第11轮脚本误认xterm的DOM测量降级节点必然存在；本版本优先OffscreenCanvas测量，因此改为检查实际DOM renderer的计算字体，不添加假节点或修改运行数据。[保留失败与宽度前后截图](evidence/local-ssh-feature-parity/source-linux-settings-failures)。

### 文件自动保存接入

复用原 `FileAutoSaveController` 的四模式与3000ms默认延迟，以及原文件设置选择控件；旧入口继续使用原数据源。控制器的文档输入收窄为它实际读取的原字段，旧 SharedFileDocument 仍可传入，没有修改原调度行为。新 wrapper 只提供当前目标文档与持有的远端revision，正常保存仍通过原filesystem.writeFile的ifMatch；二进制/截断内容不写。

先以编辑器失去焦点与窗口失去焦点测试记录未接入时的两项失败，再接入。第三项测试暴露传输丢失回复后第二次blur再次写入的问题：现在传输错误同冲突一样保持saveError，保留草稿并阻止自动重试；明确手动保存/关闭重读仍可恢复。原控制器的10项回归与新文件/设置组件合跑29项、116断言通过，desktop类型和17语言严格编译通过。一次合跑与pretypecheck图标生成并行，读取manifest时被生成器临时删除导致未运行文件组；生成完毕后同一套测试顺序运行通过。该基础设施失败日志仍保留，不计产品故障。

此实现目前服务于当前单文件编辑器，多文件保留与跨工作区草稿仍待接入；不能据原控制器源码已经支持多文档就声称新界面具有完整多文件能力。实际SSH窗口增加从原设置切换On focus change、只编辑并转移焦点、后端只读核对内容、Off与重开持久偏好的脚本，该检查点最初待运行，实际结果如下。

冻结源码 `b6d7282e7529f90a1a31b9beab62caf556187360` 的第13轮真实Linux Electron/SSH窗口通过：从原自动保存控件选择On focus change、编辑当前远端文件、只转移焦点而不点击Save，后端只读确认内容为`saved through original autosave controller`；关闭自动保存并关闭/重开后最终偏好保持，3个原execution保持。该轮恢复循环1次，仍不是Mac安装包或供应商CLI验收。[实际记录和原版控件截图](evidence/local-ssh-feature-parity/source-linux-auto-save)。

## 阶段三底座：原文档存储可按后端隔离（多文件界面待接入）

原 FileDocumentStore 提取实例工厂；旧导出继续使用一个默认实例，原读取10MiB与明确loadUnlimited行为不变。新实例可限制初始读取并禁用不限读取，用于新工作站的有界管理。读写依赖收窄为原存储实际使用的filesystem.readFile/writeFile，仍接受旧完整client。没有修改tRPC过程或旧共享文档输出。

TDD先记录工厂缺失，再验证两个后端即使拥有相同workspaceId与绝对路径也隔离内容；已编辑草稿在release/acquire后保留；新读取限额与旧默认分别生效。原文档存储、自动保存与新隔离测试合跑32项、120断言通过，desktop类型检查通过。[底座红绿日志](evidence/local-ssh-feature-parity/stage3)。新多文件标签、跨页面草稿管理、文件树与实际窗口证明仍待完成，工厂存在不算功能已接通。

### 多文件标签与草稿接入（真实窗口待运行）

文件视图改用原文档存储实例及原WorkspaceTabBar；新增可选语义标签属性、隐藏无操作的加号、以及关闭菜单完成退出后再回调，旧调用默认行为保持。文件标签支持切换、排序、命名、关闭/关闭其他/关闭全部。未保存标签关闭需确认，批量关闭一次列出全部目标；明确的Close file and discard draft仍直接丢弃本地缓冲，不删除远端文件。

文档实例按connectionId/backendId/namespaceId隔离，工作区与路径继续使用原存储键；同后端重连更新generation并保留缓冲，更换后端禁用旧写入。使用原自动保存控制器管理全部已持有文档，单文件中间层已移除。总文档默认20（可注入1–100以测试限额）、后端实例10、读取1MiB且不提供不限读取；命名与排序等元数据随持有文档清理。UTF-8严格解码、BOM/CRLF与二进制边界通过原测试；格式元数据按稳定文档id清理，不被已释放旧读取污染。保存保持ifMatch，不盲重试；当前尚未接入原冲突覆盖/完整对比、文件树、多种预览、全局草稿入口与退出提醒，不能据此称文件组全面完成。

TDD记录多个文件入口不存在、后端旧激活导致旧写入、已释放读回复污染换行格式等失败，再修复。新文件/后端/旧存储/自动保存/恢复/架构合跑75项、289断言通过；后续增加共享provider跨工作区草稿测试，文件组件20项、91断言通过；原panes121项、260断言与panes/desktop类型检查通过。17语言严格编译与Electron构建通过。关闭全部测试最初菜单文案写错（原版是Close All），改正后复现单项确认与菜单退出抢焦点问题，批量确认与延后回调后通过；该夹具错误单独保留，不作为产品故障计数。

新增实际窗口脚本将使用物理输入验证两个文件草稿、切回后的撤销/重做、保存只写选中文件、关闭取消与批量丢弃，以及后端只读核对；本代码检查点的真实结果待独立记录。

### 多文件真实源码窗口通过

第17轮冻结源码 `3c226778c5fd3185e6f15bd1094026e84be535b0` 通过，实际产品构建源为 `fa39fde73a0873f4da7a8efe6f1812ed59f8feff`；中间三次提交仅改验收脚本。使用真实SSH、物理输入两个文件不同草稿；切换回来后原CodeMirror撤销/重做生效，保存前后端内容未改变，保存仅改选中文件；关闭非当前未保存标签需确认，取消保持原选中编辑器和两个草稿；原Close All菜单退出后一次确认全部目标，丢弃缓冲不修改第二个远端文件。恢复循环仍1次，Linux源码不替代macOS包或真实供应商认证验证。[实际记录和截图](evidence/local-ssh-feature-parity/source-linux-multiple-files)。

第14–16轮均为脚本交互假设错误：Linux原重做键是Ctrl+Y（Mac为Cmd+Shift+Z）；原关闭按钮需要悬停才能出现；取消关闭非当前标签不会自动切换选中编辑器。按原控件的实际语义和物理命中条件修正后通过，不改变运行数据、不加假节点，不计作产品故障。[失败日志与截图保留](evidence/local-ssh-feature-parity/source-linux-multiple-files-failures)。

## 阶段四：原版文件树与编辑布局（实际窗口待运行）

提取原 FilesTab 的 FileTreeSurface 与折叠目录操作，原账号入口继续使用同一实现。工作站使用原 Pierre 模型、28px行高、10px缩进、图标覆盖与点击策略；点击策略的纯函数从云端偏好 hook 中提取，旧 hook 合同保持。目录按需从所选后端 filesystem.listDirectory 加载；展开只增量添加，刷新保留展开状态、先核对父目录再读取仍存在的子目录，最多10000路径、刷新读取并发最多16。旧连接晚回复不能安装到新树，越界目录回复与超限批次拒绝且保留当前树。

文件树替换原工作站的按钮列表，使用现有可调整分栏组件与编辑器左右布局；右键菜单复用原 PierreRowContextMenu 和已有工作站文件操作内容，仍在菜单完成退出后打开确认层。重命名/移动成功后将确认的变化交给原文档存储，保持id、草稿和换行格式；目录删除标记所持有的子文档为孤立，不丢弃草稿。旧generation事件忽略。这是明确操作后的接入，尚未提供完整远端文件监听。

TDD复现并修复展开重置导致自动折叠、刷新已删除目录导致整次失败，以及Files/Changes切换丢失CodeMirror撤销记录；新文件树缺失、Collapse All缺失与文档事件接入缺失的红日志也保留。组件验证使用实际Pierre shadow-root行，不用假列表替代。测试选择器最初误写web-component标签/假定折叠后缓存行必删除，随后改按原组件实际标签及普通目录行的aria-expanded核对；一次编辑误替换归属数组造成自引用，测试/类型检查发现后修正。国际化脚本首次在desktop子目录运行而不是仓库根，未执行；根目录重新执行通过。这些失败独立保留，不计入通过结果。

当前相关回归97项、421断言通过，desktop类型检查、17语言严格编译与Electron构建通过。实际SSH窗口增加物理展开目录、目录内新建文件、保留同级文件、折叠重开与目录删除确认脚本，运行结果另行记录。拖拽移动、原版内联新建/重命名、完整预览、远端监听、快捷键和全部文件设置仍需继续补齐，不能将本阶段当作整个文件组完成。

### 真实目录删除发现并修复确认层归属问题

第18轮已经走通树中的文件/Git操作，但脚本末尾仍查找已替换的旧文件按钮；第19轮在Files重新挂载、New Folder尚未可用时点击，均修正脚本后重跑。第20轮由物理输入完成目录内新建、同级文件保留、嵌套文件打开、Collapse All和再次展开；实际删除目录成功后确认层未关闭。原对话框把当前浏览目录纳入所有操作的归属，刷新选回工作区根后误认为删除结果过期。新增同一路径回归先失败，再改为只有新建操作依赖浏览目录，保留工作区/后端/generation/目标路径检查；6项对话框回归通过，只有一次删除请求。产品实际复测仍待记录。新增物理Files/Changes切换后原撤销/重做检查，不能以组件测试代替这一实际验证。

### 文件树真实源码窗口通过

第22轮冻结源码 `6b0993fc7de20deeb594c4d959c4fa4d174af01d` 通过。物理输入在原版树中创建目录、在所选目录内新建文件、打开嵌套编辑器，保留同级文件，Collapse All后再次展开；右键确认删除目录后树和后端只读查询一致、确认层关闭。第21轮在长路径选中后新建按钮的位置随换行变化，脚本点击未命中；路径改为原样title加单行截断，第22轮核对目录选择前后按钮bounds一致并通过。第21轮已实际通过Files/Changes切换后的撤销/重做；第22轮同时完整通过原文件/Git、设置、多文件和恢复生命周期回归。

[成功截图与实际记录](evidence/local-ssh-feature-parity/source-linux-file-tree)，[第18–21轮失败](evidence/local-ssh-feature-parity/source-linux-file-tree-failures)。最新相关回归98项、424断言通过，类型检查、17语言严格编译与最终Electron构建通过。恢复采样仍1次，真实SSH/心跳PTY的Linux源码验收不是Mac安装包或供应商认证验证；整个目标仍进行中。

## 阶段五：原版 Git Diff 展示（实际窗口待运行）

原 LightDiffViewer 的数据源 wrapper 保持现有主题与electronTrpc字体查询；提取同一 LightDiffSurface，让工作站注入已经接通的主题/字体。工作站的Before/After纯文本框替换为原Pierre Diff渲染，复用原 DiffViewToolbar 和 DiffFileHeaderName，以及从原DiffToolbar提取的未改动区域控件。该控件使用已有17语言文案，旧调用方式与语义保持。双栏/统一视图与是否展开未改动区域复用原useSettings固定小型本机偏好，其localStorage键已在原注册表中；不增加工作区级缓存或账号数据源。

先增加原Split/Unified控件和未改动区域控制缺失的失败测试，再实现。测试使用实际Diff shadow-root删除/新增行，覆盖切换、折叠/展开，确认只读取一次所选工作区Git差异；追加字体改变后原surface更新的回归，没有mock内部渲染器。测试最初在lazy import完成前检查节点、随后误用deletion/addition而不是原change-deletion/change-addition行类型，修正夹具并保留诊断日志，不作为产品通过记录。相关桌面合跑68项、320断言通过，desktop类型、17语言严格编译通过。

实际窗口新增物理查看SSH差异、统一/双栏切换、真实代码行17px字体、未改动区域及折叠控件，以及关闭/重开后恢复视图偏好的检查点。此代码阶段结果待记录；完整Git历史、分支、同步与PR界面尚未接齐。

### 原版 Diff 真实源码窗口通过

第24轮冻结源码 `8438e60a1f30d3a5f239e345b51b16d9e464d8e8`，产品构建源为 `0724c5f60996bff12ed32327e2e2e4d3ab04dcaf`，后续提交仅调整验收所选文件。物理查看已提交文件的真实SSH差异，核对删除的三行与新增的两行；原控件切换统一/双栏，实际代码行字体17px；显示全部行/隐藏未改动区域、折叠/展开通过；保存为统一视图后关闭/重开，原控件选中状态与实际渲染保持一致。工作区恢复、文件/Git操作、设置、多文件与树回归也通过，恢复采样仍1次。

第23轮脚本选择了仅新增内容的未跟踪文件；原Pierre对新增/删除整文件采用单栏，即使Split控件被选中也保持单栏。该原行为保留，不强造空白侧；脚本改用两侧内容均存在的已提交文件，第24轮双栏通过。[成功截图与实际记录](evidence/local-ssh-feature-parity/source-linux-git-diff)，[失败夹具与截图](evidence/local-ssh-feature-parity/source-linux-git-diff-failures)。此证据仍是Linux源码/真实SSH与心跳PTY，不替代Mac发行物或供应商认证；整个目标未完成。

## 阶段六：可分页的完整提交历史（实际窗口待运行）

新增可选 `git.listRepositoryCommitsV1` 与 `workstationGitHistoryV1`，旧 `listCommits` 的相对基础分支范围、输入、输出和默认行为保持。新查询通过原Git worker执行，默认50条、最多100条；游标固定HEAD与偏移，新提交出现后继续读取同一快照，NUL分隔保留标题中的制表符。空仓库返回真实空历史，无效HEAD保留错误。新能力需要后端描述、主进程能力白名单与过程注册表均支持；旧后端在调用前禁用入口。

历史界面复用原CommitRow，每页50条、前后分页只持有当前页，不增加localStorage实体缓存；连接/后端/工作区切换与晚回复隔离。选择提交读取原getCommitFiles，再以原getDiff的`commit`类别及明确commitHash展示同一提交，后续未提交修改不能混入。原Diff控件与文件草稿继续使用同一实现。

TDD保留缺少后端过程、主进程未接入/未转发新能力、历史组件/入口缺失的红日志。真实临时Git仓库验证分页中新增提交不改变旧HEAD快照、制表符标题、输入界限和旧API行为；worker注册表及空仓库/无效HEAD合跑4项、13断言通过。无效HEAD最初直接以Bun的失败Promise matcher等待worker错误时发生超时；独立worker与路由探针立即报错，改为先await/catch再断言后同一数据通过，没有增加超时或改假错误结果。首次格式检查混用根目录与子目录的路径、两次类型检查暴露测试Promise泛型和加载函数参数未接齐，均修正并保留失败记录。

最新相关桌面合跑85项、358断言通过，desktop/host类型与17语言严格编译通过。实际SSH窗口新增读取原提交行、选择已提交内容、对照后续未提交草稿的检查点，运行结果待记录。分支、基础分支、同步、完整PR和其余原版能力仍需继续接入，整个目标未完成。

### 提交历史真实源码窗口通过

第25轮冻结源码 `b544f84f3d9111af7c70c5a6e5db4ef41e3875fb` 通过。真实SSH后端提供新能力，原提交行由物理点击选中`Feature parity commit`；原文件列表与Diff显示该SHA中的`first / feature search candidate / last`，没有混入当前工作树的`first retained editor draft`。查询、界面及提交内容一致；原文件、设置、多文件、树、Diff与恢复生命周期回归也通过。[截图和实际记录](evidence/local-ssh-feature-parity/source-linux-git-history)。分页并发中新增提交的固定快照由真实小型Git仓库集成测试验证，这轮窗口只有一个提交，不冒称实际窗口跨页采样。仍为Linux源码/真实SSH与心跳PTY，恢复采样1次，不替代Mac包或供应商认证验证；完整目标仍未完成。

## 阶段七：原版基础分支控件（实际窗口待运行）

复用原BaseBranchSelector，增加可选disabled且旧调用默认不变。所选后端提供分支、当前基础配置和默认分支；明确选择调用原setBaseBranch，Auto恢复原null语义。确认后的比较值传入原getStatus和against-base getDiff，已有commit/staged/unstaged差异保持原参照。写入回复丢失时只读getBaseBranch核对，不再次发送写入。

TDD先记录控件/接入缺失，再复现已保存基础分支晚到、原默认分支差异仍在读取时安装错误结果的问题：状态/差异查询持有其比较值，晚旧结果不安装；当前操作完成后刷新新比较，不改变工作区epoch或丢弃编辑草稿。控件选择/Auto、单次丢失回复核对与真实原调用参数通过；相关桌面合跑67项、325断言通过，类型与17语言严格编译通过。实际SSH窗口增加从原选择器写入main、后端核对、Against base差异与恢复Auto的物理输入检查，结果待记录。分支重命名、同步及其他原功能仍待继续接入。

### 无远端默认分支的实际边界

第26轮控件留空，真实临时仓库只有本地main且没有远端默认分支。原getBranchSyncStatus允许defaultBranch为null，不能把它当作唯一显示值。新增同一边界测试先失败，再回退到原当前分支/本地HEAD名称，3项控件测试通过。未改原API返回值，实际窗口复测仍待记录。

### 基础分支真实源码窗口通过

第27轮冻结源码 `5c3a10f4e6e68fe9c547b9175d70e2a71e2526f3` 通过。物理使用原BaseBranchSelector选择本地main，后端getBaseBranch确认配置；打开Against base差异，再由原Auto语义恢复null，后端核对一致。原文件、设置、多文件、树、Diff、历史与恢复生命周期回归仍通过。[截图与实际记录](evidence/local-ssh-feature-parity/source-linux-git-base)，[第26轮失败](evidence/local-ssh-feature-parity/source-linux-git-base-failures)。实际只有一个本地分支；多分支参数传播、旧比较晚回复和丢失写入回复由组件回归覆盖，不冒称本轮实际窗口验证了多个分支。Linux源码/真实SSH与心跳PTY、恢复采样1次，仍不替代Mac包或供应商认证；目标继续进行。

## 阶段八：原版分支重命名与推送（实际窗口待运行）

提取原RenameBranchDialog的同一展示组件，旧wrapper与API保持；提取原ShipControl的Push按钮，两入口共用。工作站接原git.getBranchSyncStatus/renameBranch/push，不要求Superset账号。已跟踪远端的分支禁用重命名，无远端或分离HEAD禁用推送；旧后端缺少workstationGitV1或durableOperations时在调用前禁用对应操作。推送使用现有持久operationId与主进程日志，回复丢失不自动重发。

重命名保留输入法Enter保护、同步双击锁与后端/命名空间/generation/工作区归属；丢失写入回复时只读查询当前分支，确认已改名再关闭，结果未知保留草稿并先Refresh核对，不发送第二次写入。状态跟随Git刷新更新，基础分支控件在当前分支改变后重读配置。已收到成功回复、后续状态读取失败仍需刷新工作区的回归先失败后修复。

新增入口缺失的红日志，以及7项行为回归与原文件/Git/基础分支、主进程和无账号启动检查合跑67项、644断言通过。测试首次等待立即拒绝后的Dialog卸载与Bun/DOM调度相互阻塞，改为await act完成同一交互后断言，没有放宽超时；类型检查发现Testing Library的ByRoleOptions不支持exact参数，移除后通过。desktop类型、17语言严格编译与构建结果见独立日志。实际窗口脚本将通过物理输入重命名，再向SSH后端上独立的本地bare仓库推送，核对HEAD与持久操作记录；不作为GitHub认证或Mac包证据。运行结果另记。

2026-10-15用户允许清理账号专属多余源码，已更新设计约束。当前启动的依赖审计扩展到src别名，无Superset账号/云启动依赖。旧账号源码整链仍待按共享组件依赖逐批清理，不能据此声称已经删除完毕。完整原版功能目标仍未完成。

### 分支重命名与推送真实源码窗口通过

第28轮冻结源码`9fa755eb2`通过。真实SSH窗口用物理输入将main重命名为feature-renamed，原状态与基础分支控件更新；验收夹具仅准备SSH后端上的独立本地bare仓库，随后物理点击原Push按钮，后端确认hasUpstream=true/pushCount=0，独立bare仓库HEAD与当前仓库历史HEAD一致，主进程待处理操作数为0。截图已实际查看。[记录与截图](evidence/local-ssh-feature-parity/source-linux-git-branch)。

文件、设置、多文件、树、Diff、历史、基础分支与恢复生命周期回归仍通过。本轮Linux源码、真实SSH和心跳PTY、恢复采样1次，不代替GitHub认证、供应商Agent或Mac安装包。它验证原版已有push，不声称已补原版未提供独立过程的pull/fetch；整个功能对齐目标仍进行中。

## 账号专属代码首批清理

删除旧v1/v2工作区侧栏的usePaymentFailedCard及barrel导出、hook调用和卡片候选项，共移除133行专属hook。它只查询Superset订阅、组织成员与未付发票，并提供官方计费/发票入口。共享SidebarCardSlot、项目setup提示、侧栏工作区构建和其他原版能力保持；没有持久化键，无数据删除或迁移。仅删除专属代码，没有放开或伪造官方付费接口。desktop类型检查通过，无账号启动、持久化注册表、原侧栏项目构建和现有引导卡片回归合跑30项、2097断言通过。[检查记录](evidence/local-ssh-feature-parity/account-cleanup)。旧账号页面、旧主进程启动、Paywall及无用依赖仍待按引用继续清理；第三方Agent/GitHub登录和SSH/后端校验继续保留。此清理不等于全目标完成。

随后将无账号启动审计补全为别名、barrel导出与字面量lazy import的传递遍历；所有运行入口通过673项依赖断言。原alias检查日志首次运行即通过，归档名改为alias-audit，避免误称红测试。没有借此声称旧账号源码全已移除。

## 阶段九：原版 Fetch/Pull/Sync（实际窗口待运行）

原CommitInput的Pull、Sync、Fetch与Fetch & Pull菜单提取成同一GitSyncMenuItems，旧入口保留原默认禁用条件；将原fetch当前跟踪分支及缺失上游fallback、原冲突/上游错误分类提取到host-service纯Git模块，两入口共用。新后端syncBranchV1只接受明确workspaceId与action，通过原凭据环境和Git worker执行。Pull仍为git pull --rebase，Sync先pull/rebase再复用原gitPushTask，无上游按原流程发布；不自动stash、reset、丢弃或重放。冲突保留真实工作树与变基状态，status在失败时也失效。现有API输入、输出、错误、传输与默认行为未改；新可选workstationGitSyncV1由describe、主进程白名单和过程注册共同声明，不提高旧连接最低版本。

所有同步动作使用现有direct.execute和持久operationId；缺少新能力或durableOperations时调用前禁用。未知回复保持本机日志并阻止另一个UUID的写入；没有自动补发。工作区/连接/generation归属校验继续生效。未保存或正在保存的原文档阻止Pull/Sync，Fetch仍可用；工作树可能变化时（含冲突/回复未知）通知原文档存储overflow与文件树刷新，干净编辑器重读，期间新草稿由原存储保留并标外部变化。

TDD先记录后端接口和菜单入口缺失，再以真实小型bare/发送端/接收端仓库验证Fetch不移动HEAD、Pull更新、两边独立提交的变基推送、冲突不推送和无上游首次发布。后端相关16项、41断言通过；桌面含原错误分类、文件/编辑器/主进程等80项、1009断言通过，组件实际验证Pull后原CodeMirror重读新内容。首次UI夹具用click开启Radix菜单未打开，按原pointerDown交互修正；首次bare只读核对使用SimpleGit禁止的--git-dir参数，改为以bare目录为cwd，无放宽配置。一次批量插入import误碰原Git身份任务调用，desktop/host类型检查发现后修复；所有失败日志独立保留。最终两端类型、17语言严格编译与Electron构建通过。

实际窗口脚本将用原控件提交当前夹具内容、推送；独立夹具只在另一clone产生远端提交，再通过物理Fetch/Pull/Sync验证引用、工作树、原编辑器、双向提交与持久记录。结果待另记。Linux源码/真实SSH上的本地bare远端不冒称GitHub认证或Mac发行物；完整功能对齐目标仍未完成。
