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

### Pull后实际文件点击被Git刷新丢弃

第29轮在同步前提交说明输入处遇到脚本未定义action，修正并等待暂存完成后重跑。第30轮由物理Fetch确认pullCount=1且HEAD不动，物理Pull后HEAD与远端一致，filesystem只读确认新内容；但紧接着点击新文件未打开编辑器。组件回归固定一条未完成的Git状态读取，点击原树文件先失败，确认openFile错误地走了会丢弃忙时请求的mutating run锁。打开/选中文档改为归属检查后直接复用原文档存储（后台读取仍由其隔离），异常按原report上报；不重发任何Git操作。桌面回归81项、1015断言通过，实际复测待记录。

第30轮脚本实际为0013dceda、产品构建为ac4e851b9，但运行环境误填了不存在的sourceRevision标签；该轮只保留为失败诊断，不作为冻结源码验收。后续运行从git rev-parse HEAD自动取得标签。[第29–30轮失败记录](evidence/local-ssh-feature-parity/source-linux-git-sync-failures)。

### 原版同步菜单与编辑器刷新真实源码窗口通过

第31轮冻结源码`37acf22f3bb156c7b11dbd01388db7661c7b625a`通过。物理使用原Stage All/Commit/Push准备干净夹具；独立发送端只准备远端变更，物理Fetch确认落后1个提交且本地HEAD不动，物理Pull更新HEAD。保持第30轮同样立即打开新文件的交互，原CodeMirror正常显示remote one，修复后的回归已在真实窗口复现通过。随后物理新建并提交sync-local-ui.txt，发送端再更新sync-ui.txt；Fetch后push/pull计数各1，物理Sync完成变基与推送，独立bare远端与工作区HEAD一致，原已打开编辑器更新为remote two，两计数归0、工作树干净、持久待处理操作为0。截图已实际查看。[记录与截图](evidence/local-ssh-feature-parity/source-linux-git-sync)。

文件/Git/设置/多文件/树/Diff/历史/基础分支/重命名/推送以及窗口关闭/重开、后台PTY和恢复生命周期回归通过。恢复采样仍为1次，Linux源码/真实SSH、Git远端为SSH后端上的独立本地bare仓库；实际窗口未覆盖Fetch & Pull第四菜单项（组件/共享命令已接入），冲突保留由真实Git仓库集成测试覆盖。本证据不替代GitHub认证、真实供应商Agent或macOS包验收；其他功能组继续进行。

### Fetch & Pull第四菜单项真实源码窗口通过

第32轮冻结源码`9994f1865c211c12815d6fcfb549ae573908d68a`通过；产品构建源仍为`37acf22f3`，中间只更改验收脚本与文档。再次完整通过第31轮Fetch/Pull与两边独立提交的Sync后，独立发送端第三次更新同一文件。物理点击原Fetch & Pull菜单，后端HEAD确认新SHA，原已经打开的CodeMirror显示remote three，主进程待处理操作0。截图已查看，原窗口关闭/重开与后台PTY、恢复生命周期回归通过。[第四菜单项实际记录](evidence/local-ssh-feature-parity/source-linux-git-sync-combined)。

四个同步入口均已接入并有实际Linux源码/SSH窗口证据；变基冲突由真实Git集成测试验证保留，未将其冒称实际窗口冲突解决流程。恢复采样仍1次，Git远端为SSH后端上的独立本地bare仓库，不替代GitHub认证、供应商Agent或Mac发行物。Git撤销修改、完整变更列表、分支其他操作和PR，以及其他功能组仍需继续实施，完整目标未完成。


## 阶段十：每台机器统一管理 Remix worktree

用户确认默认目录为每台运行机器上的 `~/Superset Remix/worktrees/`，继续复用原项目名称消毒和分支子目录规则；项目文件夹使用项目名加完整项目ID。本地后端使用本机 home，SSH 后端使用远端 home；后端私有数据库目录与 sessions 不随 worktree 目录改变。新建 worktree 的普通分支与 PR 路径复用同一解析器，清理的两个受保护删除分支使用同一路径策略。已有主机/项目覆盖设置在 direct 模式不影响创建或删除，设置接口拒绝将目录改到其他位置，允许清除或提交统一目录；原非 direct 模式的设置和 API 形状保持原样。

按全新数据实现，不迁移或删除现有目录，不移动项目原始仓库。显式导入现有 worktree 继续复用原导入能力，导入不会自动移动它；这条目录策略约束应用新建的 worktree，不约束用户或第三方 Agent 自行执行的任意 shell 命令。应用的 Agent 启动继续复用原工作区 cwd，未添加供应商私有 worktree 参数。第三方认证与会话目录也不混入此工作区目录。

TDD 首先记录三个失败：worktree 仍位于后端私有目录、主机设置暴露旧覆盖、Agent 私有目录覆盖可写。实现后定向测试3项/15断言通过；真实 Git 创建与主仓库移走后的受保护清理均验证统一路径，且没有云 API 请求。包含原非 direct 自定义主机/项目目录与路径越界、符号链接保护的40项/133断言回归通过，host-service 类型检查通过。首次绿测试将旧删除接口参数误写成 workspaceId，改为原接口的 id 后通过，没有改变发布 API。[红绿与回归日志](evidence/local-ssh-feature-parity/stage10)。

源码 SSH 界面验收增加统一路径断言及三个现有终端进程的 cwd 只读核对；夹具为隔离远端 home 显式设置后台进程 HOME，避免误用验收机器的真实 home。实际窗口结果待独立记录。完整功能对齐与 macOS 安装包验收仍未完成。


### 接通原版 Worktree／Local 选择器

第33轮冻结源码`e9771bfa2bc0e9e717756b4146d1823e346d00b0`在统一路径断言失败：既有恢复脚本创建的是无项目的 standalone session，按设计仍位于后端私有 sessions 目录；不能拿这个结果证明项目 worktree 的实际路径。检查同时确认旧工作站项目会话入口把 checkout 固定为 local，未提供新 worktree 选择。该轮失败保留，不计为统一目录通过。[失败日志与截图](evidence/local-ssh-feature-parity/source-linux-worktree-location-failures)。

补接原 DashboardNewWorkspaceModal 的 CheckoutPickerPill 与其 FormPickerTrigger，直接使用原 Worktree／Local 图标、说明、菜单与翻译，无新登录依赖；选择项目默认 worktree，用户可以明确切换 Local，standalone session 继续独立。创建请求继续通过原持久操作桥与 workspaces.create，使用后端原命名、分支和路径规则，不在渲染器拼接实际远端路径。原 runSetup:false 保持，不隐式运行项目脚本。

组件 TDD 先验证原选择器缺失，再接入；请求转发测试验证选定机器收到 checkout:worktree。首次测试的 New session 选择器命中两个原按钮、原 Radix 菜单需要 pointerDown，修正测试交互后12项/40断言通过，相关恢复、项目创建与无账号启动链回归18项/748断言通过。17语言提取与严格编译通过，没有新增文案或翻译。实际验收脚本改为物理创建项目、选择项目、保留原 Worktree 默认值，再创建工作区；后续核对统一路径与真实终端 cwd，结果待另记。


统一根目录还会被同一机器上的多个独立后端命名空间共用。真实双仓库测试先复现两个独立数据库中同名项目、同名分支抢占同一目录的CONFLICT；direct 项目分组改为`<消毒项目名>-<完整项目ID>`，不依赖另一个数据库中的项目清单，清理守卫同时认识这个分组。原非 direct 命名不变，不迁移已有工作树。该回归及最终检查结果随日志记录。


最终后端回归41项/136断言通过，包含同名跨命名空间项目的真实 Git 创建。统一目录新增可选能力标志 workstationManagedWorktreesV1，主进程仅转发已验证后端的声明；旧后端仍按既有 Local 行为工作，不显示统一目录承诺。含旧后端缺少标志情形、原恢复、项目创建、主进程桥与无账号启动审计的桌面回归42项/809断言通过。该标志是可选输出字段，没有新建或收紧原过程输入，也不提高旧主机最低版本。


第34轮冻结源码`576cc4a0652275ec50cb56575ea94cb62996a795`通过实际创建项目、原 Worktree 选择器、新工作区三个终端及正常退出/重开；后续文件/Git脚本在保存Git身份时只等configured为真，原有全局身份已经满足，随后点击了刷新期间禁用的Stage file。截图确认按钮禁用；改为等该原按钮disabled=false后进行物理点击，不增加等待次数、不重复写入、不更改产品。统一目录核对前移到三个终端正常退出/重开后、其余文件/Git回归前，单独记录工作树路径和三个进程cwd；之后的Git流程继续复核同一目录。[第34轮失败记录](evidence/local-ssh-feature-parity/source-linux-worktree-location-failures)。

第35轮是验收脚本提前读取尚不存在的恢复任务：新建连接并非恢复，getWorkspaceRestore 此时为null。移到原有正常退出/重开完成后读取，不调用内部创建接口或更改产品状态，失败日志继续保留。产品构建源仍为576cc4a06。


第36轮冻结源码395cf9265实际通过统一路径与三个进程cwd、正常退出/重开、文件暂存提交、设置、多文件、树、Diff和历史。后续基础分支过程已只读确认main写入，但脚本在父界面Git刷新尚未完成时点击禁用的Against base，没有切换分类。保留原等待次数，先核对原按钮disabled=false，再物理点击；这是另一处旧独立会话夹具没有暴露的交互时序假设，未修改产品。统一目录与cwd的该轮结果单独保留，整轮不计完整回归通过。


### 项目 worktree 暴露无 origin 的基础分支差异缺口

第37轮补齐点击条件后仍未显示基础分支文件。真实 Git 回归先复现：无origin的项目main已有初始提交，worktree分支新增并提交文件，getStatus(baseBranch:main).againstBase却为空。原引用解析器默认使用origin/main，缺失引用的diff被折叠为空；这不是按钮等待可以解决的问题。

保持原API输入、输出和非 direct 行为，通过后端内部 allowLocalBase 参数补齐直连模式：已配置upstream或存在origin跟踪引用时复用原解析；仅缺少该远端引用且本地分支实际存在时比较refs/heads/<branch>，不创建假远端、不写Git跟踪设置、不安排不存在的origin抓取。状态、单文件Diff、批量Diff、patch和二进制side使用同一规则，后台任务参数仍为可选。

新真实worktree回归先红后绿，并核对列表、单文件内容、bulk、patch和side一致；包含原分叉上游、远端默认分支和bulk/patch视图的40项/101断言通过，host和desktop类型检查通过。产品构建与实际SSH复测另记。第33–37轮失败记录保留，前述把第36轮仅判断为点击时序的结论由此修正。


### 统一 worktree 与本地基础分支真实源码窗口通过

第38轮冻结源码`7bab123cca13b3187476403895143c1f4ffa0d4b`完整通过。使用全新配置及隔离home的真实SSH，物理创建Unified Project、原CheckoutPickerPill选择Worktree、创建restore-lifecycle工作区。后端只读结果位于`~/Superset Remix/worktrees/Unified Project-<完整项目ID>/restore-lifecycle`；通过拥有的PTY daemon获取三个实际PID，逐个核对Linux /proc/PID/cwd，均为同一worktree。正常退出/重开保持原execution，客户端关闭时三进程都有新输出；这三个是心跳PTY，不冒称已认证供应商Agent。

同一轮通过文件/Git身份/单文件暂存提交、原设置、多文件、树、Diff、历史，以及无origin项目选择本地main后的真实基础分支Diff和Auto恢复。原分支重命名、Push、Fetch/Pull/Sync/Fetch & Pull全部通过，远端与工作区HEAD一致、已打开原CodeMirror更新、待处理操作0。原窗口关闭/重开、断线恢复、离线、后端重启、部分终端结束、三工作区标签及daemon丢失不自动重建的生命周期检查通过。截图已实际查看。[第38轮数据与截图](evidence/local-ssh-feature-parity/source-linux-worktree-location)。

该feature已具备源码、TDD、真实Git与真实Linux/SSH窗口证据。恢复采样为1次，SSH/Git均使用拥有的隔离夹具，Git远端为同一SSH后端上的独立bare仓库；不替代GitHub/供应商认证或macOS安装包验收。新1.37.7 DMG尚未生成，其余功能对齐清单继续进行。


## 阶段十一：目标机器上的项目设置基础

新增可选workstationProjectsV1能力；工作站主进程的原过程注册表允许显式projectId作用域，复用原project.get/update/setColor/setBranchPrefix/setNamingInstructions/setSparseCheckoutPaths。不改变这些API的输入、输出、类型或已有错误合同。未声明能力的旧后端没有项目设置入口，所有请求仍检查当前连接generation。

原V2ProjectSettingsBody提取纯ProjectSettingsLayout头部和容器，旧页面继续使用同一布局、原控制器与所有插槽。新工作站侧栏复用SidebarMenuAction，设置面板复用该布局、SettingsSection/SettingsRow、ColorSelector、BranchPrefixControl及原Input/Textarea。布局单独使用最大900px侧面板，入口按需加载，避免项目设置代码增加首屏载入。设置包含名称、颜色、分支前缀、命名说明和稀疏检出；仓库地址与位置只读，worktree显示既定统一目录，没有任意覆盖入口。

元数据字段以失去焦点或明确选择提交；只在单个写入完成后读回所选项目的规范结果。回复丢失只读回查，字段一致时确认状态，不重发写入；未确认时保留草稿并阻止后续blur写入，用户可显式Refresh读取当前状态。切换connection/backend/namespace/generation/project、关闭弹窗或能力改变后旧结果不能安装或刷新新目标。名称支持IME保护、Enter失焦和Escape取消当前编辑。

TDD先记录主进程未开放项目过程、界面组件缺失；补充未知回复草稿保留、回复丢失不重放、关闭后的晚回复与切换目标后旧写入隔离。桌面相关45项/849断言通过，包含原恢复、主进程桥与完整无账号启动导入审计。首次测试预期漏掉旧桥既有connectionId/generation字段、误将同一仓库路径的两个展示节点当作唯一，修正测试后通过。17语言提取与严格编译、desktop与host类型通过。[阶段十一红绿日志](evidence/local-ssh-feature-parity/stage11)。

项目改名后不移动运行中的工作树。真实Git回归先复现主仓库移走后，清理守卫不认识旧名称-完整项目ID目录；现按完整UUID确认原分组，仍拒绝分组根本身、其他完整UUID、越界和符号链接逃逸。相关后端17项/41断言通过。

项目设置组尚未全面完成：图标上传与选择、原500ms文本自动保存调度、保存状态呈现、项目脚本和危险操作仍需接入；当前不是完整原版设置页替代。实际Linux/SSH窗口验收增加物理打开、改名/颜色/前缀/命名说明/稀疏检出、读回和重开，结果另记。


第39轮冻结源码21ee31df5，真实窗口已通过打开900px原布局（scrollWidth未溢出）、项目改名与颜色读回；前缀菜单点击后的模式读回未满足。该轮不计完整项目设置通过，原失败与截图保留。脚本补充菜单截图及失败时后端/DOM诊断，改用原Select支持的物理End/Enter选择Custom prefix，并等待菜单退出后再编辑前缀；产品代码尚未因此改变，原因待复测确认。[第39轮失败记录](evidence/local-ssh-feature-parity/source-linux-project-settings-failures)。


第40轮冻结源码ee65aa624的键盘操作与完整原流程通过：元数据读回为Unified Renamed、#3b82f6、custom/remix、命名说明和两条稀疏路径，重开一致；面板clientWidth/scrollWidth均899px，原worktree路径保持。文件/Git/同步/恢复完整回归通过。但是实际查看前缀菜单截图时发现原Select的portal位于弹窗下方，键盘可以操作隐藏菜单，不能把该轮当成鼠标交互通过。

对照原组件确认：工作站自定义overlay/dialog的z-index为80/81，原Select、DropdownMenu、Dialog均为50。新建会话的原CheckoutPicker也受同一层级影响。新增实际elementFromPoint命中判据再进行鼠标选择，先保留旧样式下的失败，再把工作站弹窗与原版组件的层级规则统一。第40轮[键盘数据与截图](evidence/local-ssh-feature-parity/source-linux-project-settings-keyboard)独立记录，不替代鼠标验收。


第41轮冻结源码711295dd9在实际elementFromPoint命中条件先失败：Custom prefix节点存在，但鼠标中心命中的是弹窗内容，菜单始终在弹窗下。实际基线截图与后端元数据（prefix仍null）保留。修复仅把工作站overlay/content改为与原Dialog/Select/DropdownMenu相同的z-index50，由portal DOM顺序保证菜单在上；不改原Select业务逻辑，不抬高所有菜单的全局层级。新增新建会话菜单的物理Local→Worktree切换与实际命中判据，验证同一修复覆盖另一处原版组件。实际复测待记录。


### 项目设置与原菜单鼠标交互真实源码窗口通过

第42轮冻结源码`b5d5ced23bd34db38dbf77e6a7b440695d2bb0cf`完整通过。原前缀菜单现在实际显示于设置弹窗之上；同样的elementFromPoint判据命中Custom prefix后，以物理鼠标选择并保存remix。新建会话的原菜单以物理鼠标切到Local，再切回Worktree，之后正常创建统一目录工作区。截图已实际查看，对照第40/41轮可见菜单层级修复生效。

项目设置由原侧栏操作进入，实际改名为Unified Renamed、颜色#3b82f6、custom/remix、命名说明和两条稀疏路径均通过后端只读确认；关闭/重开后值一致。面板clientWidth/scrollWidth均899px，原仓库路径与正在运行的worktree路径未移动。完整文件/Git/设置/多文件/树/Diff/历史/基础分支/分支重命名/四同步菜单及原恢复生命周期回归通过。[第42轮实际记录和截图](evidence/local-ssh-feature-parity/source-linux-project-settings)。

恢复采样仍1次，Linux源码/拥有的SSH与Git夹具不替代macOS发行物、GitHub或供应商Agent认证验证。项目图标、500ms文本保存与状态、脚本及危险操作等仍需继续接入；完整功能对齐目标未完成，新DMG尚未生成。


## 阶段十二：复用原项目文本字段的自动保存控制器

原NamingInstructionsSection/SparseCheckoutSection提取可注入onSave的NamingInstructionsField/SparseCheckoutField，放到共同renderer/components目录；原页面保留原QueryClient包装、接口、默认500ms调度、2000ms Saved指示和原稀疏检出重试策略。原项目设置容器也上移到同一共享层。新工作站直接使用这两个原控件，不依赖旧host URL客户端或登录Provider。

直连包装启用pauseOnError：保存或只读确认失败时保留当前草稿，取消debounce和后续队列，不自动重复写入；显式Refresh读取状态并重建字段。正常保存确认后才提交期间更新的最新值，包括撤回到原值。每次只允许正在保存的文本字段继续编辑，其他元数据操作等待；该字段不会因为父表单busy而失去焦点或覆盖新输入。现有主进程/后端接口未更改。

TDD先记录共享字段不存在、工作站只失焦保存的失败，再验证debounce、保存期间输入、撤回、未知结果停止、卸载取消队列/晚回调。原SSR展示和新控制器、工作站、桥与无账号导入审计合跑41项/844断言通过，desktop类型和17语言严格编译通过。[阶段十二日志](evidence/local-ssh-feature-parity/stage12)。测试用1ms注入延迟与可控Promise，不等待真实网络超时。保存状态增加polite状态语义，显示仍复用原Saving/Saved/错误文字。

实际SSH脚本改为保持命名说明和稀疏检出文本框焦点，等待后台500ms自动保存及Saved指示，记录物理输入到只读确认的耗时；不点击保存或先失焦来替代自动保存。实际结果待另记。图标、项目脚本/危险操作和其余功能组仍需继续。


第43轮冻结源码`9583af4e29dcbfc93a895f5ad6db4ebd00076e86`完整通过。命名说明和稀疏检出均在文本框保持焦点时自动保存，物理输入至后端只读确认分别约542ms和539ms，符合原默认500ms debounce；原Saved指示已验证，聚焦截图已实际查看。关闭/重开读回一致；统一目录、三个进程cwd及完整文件/Git/设置/多文件/树/Diff/历史/基础分支/分支操作/四同步菜单/恢复生命周期继续通过。[第43轮证据](evidence/local-ssh-feature-parity/source-linux-project-text-autosave)。源码Linux/隔离SSH夹具、恢复单采样的适用范围不变，尚无1.37.7发行物验证。


## 阶段十三：复用项目图标与缩略图

原IconUploadField的字形、颜色、PNG/JPEG/WebP选择、10MiB源文件上限、128px cover缩放、移除/恢复默认和Popover提取到共同ProjectIconPicker；原页面保留host URL适配包装，继续使用同一原组件。新工作站把回调接到原project.setIcon/setColor，增加前者的主进程过程注册，不改变后端API。侧栏、工作区卡片和设置头部复用原ProjectThumbnail及统一resolveProjectIconUrl，保留GitHub头像回退和none哨兵含义。

图片解码到写入全程串行，防止重复点击；卸载后的字形解码不能写入旧项目。所选机器/generation/项目守卫、单次写入后读回、丢失回复只读确认、未知结果阻止后续操作仍由原项目设置适配器执行，显式Refresh重建图标与文本字段状态。原页面接口未变，无Superset登录Provider或新增云数据源。

TDD先记录共享组件缺失、工作站缺少图标入口及主进程拒绝setIcon的失败，再接入。原包装SSR、统一图标解析、串行操作/卸载、正常与丢失回复下移除/恢复、项目设置、桥和无账号导入审计49项/885断言通过。最终desktop类型检查通过；17语言严格编译通过，删除仅供已禁用离线按钮使用的一条旧提示翻译。图片解码测试使用受控浏览器对象，不冒充真实canvas结果。实际窗口将验证原弹层鼠标命中、字形换色、移除/恢复、浏览器文件选择交付后128px上传、侧栏一致和关闭重开，结果待另记。[阶段十三日志](evidence/local-ssh-feature-parity/stage13)。


第44轮冻结源码`4ebc88acb`实际已创建项目并显示原首字母缩略图，但旧脚本把按钮整体textContent精确比较为项目名；新缩略图的U令结果为UUnified Project，脚本在进入图标步骤前失败。截图已查看，保留该轮失败。侧栏项目按钮补充明确aria-label（避免读屏重复首字母），验收按这一可访问名称核对入口，不改等待次数或调用内部写接口。完整实际图标结果仍待复测。


### 原项目图标实际源码窗口通过

第45轮冻结源码`1f32926a1f7e99d474c5cd6d26ee6c84a3fa1ab5`完整通过。原Popover真实显示并通过鼠标命中检查；物理选择蓝色、Rocket字形，再选红色确认已保存PNG重新着色，恢复蓝色后移除/恢复默认均经只读API核对。物理点击原Upload image按钮，CDP浏览器文件选择交付已有1200px截图作为测试源（不冒称OS原生文件窗口手工操作）；实际浏览器canvas生成并保存128×128 PNG，约10.5KiB数据URI，低于原256KiB上限。侧栏、头部、控件预览的图标一致，关闭/重开后图像自然宽度128px，截图已实际查看。[第45轮数据和截图](evidence/local-ssh-feature-parity/source-linux-project-icons)。

同轮保持原500ms文本保存，命名/稀疏约547ms/557ms；统一worktree目录和三个PTY cwd、文件/Git/设置/多文件/树/Diff/历史/基础分支/分支操作/四同步菜单/关闭重开/离线/后端重启/部分结束/多工作区/daemon丢失检查完整通过。最终构建成功，初始renderer入口4,562.59kB（约4.563MB，较上一阶段约增加9kB），图标选择器位于已有项目设置lazy chunk。该轮为Linux源码、拥有的隔离SSH与Git夹具及单恢复采样，不替代macOS发行物、GitHub或供应商Agent认证。项目脚本、危险操作等功能仍待接入；新DMG尚未生成。


## 阶段十四：原项目脚本编辑器与有版本的配置保存

原V2ScriptsEditor提取为共享ProjectScriptsEditor，移动其唯一使用的ScriptField；原页面保留QueryClient/host URL包装，继续调用原config.getConfigContent/updateConfig。三个原Tabs、文本区、导入按钮、文件拖放控件、500ms调度与Saved状态均复用。新工作站启用pauseOnError，未知回复保留草稿并取消后续保存；关闭字段取消队列，晚到的文件导入不再写入卸载组件。保存期间仍可输入，撤回到原值会作为最新意图保存。新入口字段/脚本文件导入有128KiB边界。

原配置更新会覆盖损坏JSON且失败重试，因此新增config.getProjectScriptsV1/setProjectScriptsV1与可选workstationProjectScriptsV1能力；旧两个API完全保留。新过程仍使用原getProjectConfigPath和原JSON的setup/teardown/run数组，保留cwd/start与未知字段，复用workspace-fs的有界读取、revision、创建不覆盖、带版本预条件的路径锁和原子写入。整个配置最大512KiB；损坏内容、非数组脚本、链接目录/文件及过大配置拒绝编辑，外部版本变化返回CONFLICT。未新增迁移、环境变量或提高旧主机最低版本；旧后端没有新脚本编辑入口。

TDD先记录新读写工具、共享编辑器、远程适配器缺失，再实现。新存储和原配置合同24项/41断言通过；桌面编辑器/未知回复/关闭队列/旧后端/项目设置/主进程桥/无账号导入审计41项/911断言通过。host类型通过，17语言严格编译通过，无新增翻译条目。脚本配置编辑本身不会执行命令；Setup触发、Run按钮及Teardown生命周期的工作站入口仍待接通，不能把本阶段当作整个生命周期功能完成。实际Linux/SSH窗口与最终构建结果待记录。


### 原脚本编辑器实际源码窗口通过

第46轮冻结源码`c00739d12f55e33ecf04cc52bfa6d933d43759c2`完整通过。以物理鼠标切换原Setup/Teardown/Run标签，保持对应文本区焦点时原500ms自动保存触发，输入到后端只读确认分别约532ms、552ms、553ms，并显示Saved。物理点击原Import按钮，通过浏览器文件选择交付本地.sh文件，真实读取并保存到所选SSH项目的run数组，关闭/重开内容保持，截图已实际查看。该文件交付没有手工操作OS原生文件窗口，未验证拖放。保存并未执行任何脚本，不能据此声称Run或生命周期执行已验收。[第46轮数据与截图](evidence/local-ssh-feature-parity/source-linux-project-scripts)。

同一轮的项目图标/颜色/前缀/文本、统一worktree和三个PTY cwd、文件/Git/设置/多文件/树/Diff/历史/基础分支/分支操作/四同步菜单，以及关闭重开/离线/后端重启/部分结束/多工作区/daemon丢失完整通过。desktop最终类型与构建通过，初始renderer入口4,563.49kB，脚本编辑器在项目设置lazy chunk内。恢复仅1次，仍是Linux源码与拥有的隔离SSH/Git夹具，不替代macOS发行物及第三方认证验证；整体验收与新DMG尚未完成。


## 阶段十五：原 Run 控件与目标端运行记录

原V2WorkspaceRunButton提取共享WorkspaceRunControl，旧页面继续保留原快捷键和设置导航包装，新工作站注入本地/SSH设置回调。原buildTerminalCommand上移@superset/shared并保留原路径导出，命令仍按原规则以&&组合；服务端使用原resolveScript（含worktree/main repo/用户覆盖及run.sh规则）与createTerminalSessionInternal。新增窗格仍为原terminal类型，使用原Pane引擎与条件附着，不增加新持久窗格类型。原窗格图标动作补充已有tooltip的可访问名称。

新增可选workstationWorkspaceRunV1，仅在严格终端恢复可用时声明；新workspaceRun.getStateV1/startV1/stopV1要求所选workspace作用域。启动/停止进入既有主进程持久意图和direct.execute收据，不更改原过程合同或旧主机最低版本。新入口只支持项目配置来源，完整终端预设优先级接入仍待补齐。

后端在已有私有operations.db保留每工作区一条当前运行记录，最大4096条、每条256KiB；容量满时拒绝新记录，不静默遗忘运行。记录包含不可变命令快照、启动operationId/terminalId和实际executionId。活动、正在停止或未知的记录阻止第二个启动；读取、连接恢复和页面重开不会调用启动。结束记录保留作当前状态，未知运行不自动清除或重发。主进程待处理收据通过已有显式核对操作处理。

正常Stop在已观察到前台命令后向原execution发送Ctrl-C；尚未观察到前台命令时关闭该execution并发SIGINT，避免只取消启动前的空提示符而遗漏随后排队的命令。Force Stop以SIGKILL关闭原execution；条件关闭复用原daemon协议。前台进程探测增加三态导出，原bool调用保留原错误默认值；新运行逻辑在探测失败时保留未知，停止请求不会因ps失败被误标结束。旧execution被替换时拒绝信号。异常配置不会遮蔽已存运行的状态与停止入口。

TDD先记录共享控件、运行存储、远程入口缺失，另以并发状态读取先复现已确认启动卡在Unknown，再修复为按当前记录确认。后端17项/47断言、相关daemon进程/条件帧24项/68断言通过；桌面双击、未知回复核对、跨机器晚回复、恢复附着、原命令构造/定义、桥和无账号导入审计50项/924断言通过。host/desktop类型、17语言严格编译和最终构建通过，初始renderer入口4,598.72kB。实际窗口结果待记录；Setup/Teardown触发与完整预设仍不算本阶段完成。


第47轮冻结源码83bf6cdcd通过项目/图标/脚本配置后，在立即点Run时失败：实际配置已保存，控件定时读取尚未更新的旧definitionVersion被服务端正确拒绝，没有创建运行。截图已查看，保留此真实失败；不把加等待当成修复。新组件测试先验证只提交旧版本，再改为显式Run点击先读取当前定义：若其他窗口已有运行则只附着；没有当前定义则停止；只有当前定义读回后才进行一次带版本的启动。版本读取与写入之间再变化仍拒绝，不自动重试写入。Stop继续绑定原run operation/execution，不因读取到新运行而改变目标。新控件只显示实际错误原因，去除Electron自动附加的IPC方法前缀，日志与错误分类仍保留原对象。


新定义读取修复后的桌面回归51项/932断言、类型和构建通过，初始renderer入口4,599.51kB。[第47轮失败](evidence/local-ssh-feature-parity/source-linux-workspace-run-failures)及新增红绿日志保留；实际复测待记录。


第48轮冻结源码cd8b9f37a通过新定义读取、实际创建运行、前台进程观察及从Files切到终端，但原始输出行匹配未通过，未计整轮成功。截图已查看：Run被继续横向拆进已经调整过比例的窄窗格，原260px最小宽度的内容被父容器裁切，输出无法完整阅读。新增布局/窗格复用失败测试；使用同一个PaneTree拆分和原Pane引擎，在原布局下方追加35%高度的Run控制台，关闭后返回原树；下一次Run替换原控制台的资源与execution，保留paneId、用户标题和布局，避免每次Run新增一层。服务端当前记录仅增加一个previousTerminalId字段，不增加窗格种类或无限历史。验收按终端VT控制字符规范匹配完整可见输出行，并保存原始字节及规范化结果，不能把输入命令回显当作执行输出。后续实测将同时检查控制台尺寸、复用与原布局恢复。


运行窗格复用还通过失败测试发现：同一paneId更换资源后，旧失败状态会阻止新终端附着。视图内容改为按连接、资源和execution分配身份；附着/失败/重试覆盖仅保留仍属同一身份的项，晚到的旧重试读回被忽略。原paneId、布局和标题保持，未创建新后台任务。实际脚本增加强制停止后再运行，核对复用的已结束窗格能够附着新execution。


控制台布局/复用/资源身份修复后，桌面相关11文件64项/986断言、host运行相关18项/48断言通过；host与desktop类型和最终构建通过，初始renderer入口4,601.40kB。红绿日志与第48轮失败截图保留，完整实际运行仍待冻结版本复测。


第49轮冻结8ff9dc063在首个New terminal前失败，尚未进入Run步骤；保存视图为空窗格且窗口无错误提示。截图已查看。验收改为先只读确认该按钮可用且鼠标坐标命中，再物理移动/按下/释放并记录实际位置；不增加超时，不将这次尝试计为运行成功。


第50轮冻结bb0b1242c已实际完成输出、统一目录cwd、正常Stop保留PTY、二次Run同窗格、关闭重开与host重启保持PID/execution。Force Stop后原handleClose会移除daemon记录，检查脚本错误地要求记录仍存在而失败。截图已查看，Ended界面与daemon语义一致。检查改为只有提供停止前捕获PID时才接受记录移除，并直接检查Linux /proc/PID不存在；缺少行但没有捕获PID仍报错，已存在行仍核对原execution和PID。未改产品停止行为，整轮仍待复测。


第51轮冻结b46fe6241的Run子流程完整通过，940×199.34px控制台、真实输出/进程cwd、普通停止/二次运行、窗口关闭和host重启保持原PID、强制停止实际PID消失、第三次Run复用已结束窗格和恢复原布局均通过。整套随后在文件测试前置条件失败：新Run流程重开窗口后，原文件测试期望的未保存草稿已不在。阶段并未实现草稿跨窗口持久化，不能改口声称已有；将Run放到原文件草稿/提交测试完成之后，保留既有文件断言和Run的真实重开验证。该轮只记录Run子流程通过，完整回归待复测。


第52轮虚拟显示服务中断导致Page.captureScreenshot超时和X connection error，不作为产品通过记录。恢复显示服务后，第53轮同源码的Run、文件/Git、设置、树/Diff/历史/分支/四同步子流程均通过，最终整视图对比失败：关闭Run窗格按原closePane语义选择首个窗格，而老恢复基线包含之前的焦点。新Run验收在结束时通过物理点击回到开始前的窗格，并等待保存；保留完整视图恢复对比，新增期望/实际快照诊断，不略过activePaneId。没有更改产品关闭行为，后续完整结果待记录。


### 原 Run 控件及运行恢复实际源码窗口通过

第54轮冻结源码`918c1a9ed`完整通过，进程退出码0。物理编辑原Run脚本后从Files点击Run，940×199.34px控制台实际显示独立输出行，实际PTY cwd等于所选统一worktree路径。正常Stop结束前台命令并保留原PTY；下一次Run复用同一paneId、标题及布局并附着新execution。窗口关闭重开和host-service重启后，运行operationId、executionId及Linux PID均保持一致。原菜单Force Stop后daemon移除运行且捕获PID的/proc目录消失；第三次Run仍复用已结束窗格并成功附着新execution，结束并关闭后原布局完全保持。截图已实际查看。

同轮项目设置/图标/脚本、文件/Git/设置/多标签/树/Diff/历史/基础分支/分支重命名/四同步及关闭重开/离线/后端重启/部分结束/多工作区/daemon丢失完整回归通过。[第54轮数据和截图](evidence/local-ssh-feature-parity/source-linux-workspace-run)。恢复仅1采样，仍为Linux源码与拥有的隔离SSH/Git夹具；不是macOS发行物或供应商Agent认证结果。尚无1.37.7 DMG。完整终端预设、Setup/Teardown触发、瞬时命令的可靠自然结束判据仍需继续接入；当前长前台命令的验证不覆盖瞬时命令。用户新增客户端粘贴图片/文件/文字到SSH的验收要求，下一步优先核对并复用原附件上传与输入路径。


## 阶段十六：复用终端远程文件粘贴与聊天附件上传

新增失败测试确认当前工作站终端/聊天没有接上剪贴板图片上传。RemoteTerminal复用原installImagePasteFallback和uploadPastedFiles：文件写入所选机器当前工作区的原.superset/attachments约定目录，保留原清理文件名、create-only冲突命名与自忽略规则；确认上传后通过原xterm.paste粘贴转义的远端绝对路径，不发送Enter。普通文本/富文本仍由原xterm处理；直连终端显式启用preferFiles，剪贴板含实际File时优先上传，避免混合本机路径文本被误传。旧fallback默认的文本优先行为保持。发送中显示原Sending…文字；视图、连接或execution结束后的晚上传不再粘贴，后续写入前也检查归属。

聊天输入增加文件粘贴，复用已有uploadSelectedAttachment和后端attachments.upload；不新增后端API或云依赖。新的主进程IPC方法只接受实际Uint8Array、文件名/MIME与连接generation，前后验证generation。附件只进入所选聊天草稿，仍由明确Send操作发送；跨聊天/工作区/generation的晚回复不能加入新草稿。所有聊天动作加入同步防重入锁，原关闭/重连不重发prompt行为保留。剪贴板批次最多16个文件，单文件及批次字节均最大25MiB，空文件和超量在读取前拒绝；聊天还遵守现有16附件总数。未知上传回复不自动重试。

TDD保留缺少主进程方法、终端和聊天图片粘贴不上传的红日志，以及发送状态未清除的红日志。最终相关7文件47项/954断言通过；desktop类型、17语言严格检查与构建通过，初始renderer入口4,623.10kB。原fallback、附件传输及无账号启动审计一并回归。此处均为组件/传输测试，不能替代真实系统剪贴板、macOS或供应商Agent读取验证；实际窗口结果待记录。[阶段十六日志](evidence/local-ssh-feature-parity/stage16)。


第55轮首次实际剪贴板验收在远端附件出现前失败：截图显示新终端只有窄可见区域，旧中心坐标落到邻接Codex窗格，wc与粘贴没有进入新终端。截图已查看。本轮尚不能证明图片功能通过；验收改为终端screen与窗格/窗口可见矩形求交、elementFromPoint确认命中，再物理移动/点击并核对浏览器实际焦点，不调整布局来便利坐标。该轮原冻结8d9fc4d0e尚未推送，阶段提交整理时仅将67MiB递归DOM红日志截为首尾各90行并保留原始hash/字节/行数，避免把无界诊断提交进仓库。修复后的完整实际结果待记录。


第56轮仍在粘贴前的命中判据失败：最近的workspace-pane本身也受更外层原分屏容器裁切，不能用最近一层矩形代表可见区域。验收遍历所有具有裁切/滚动overflow的祖先求交，不移动或扩展窗格；只有可见命中且实际焦点属于目标终端后才输入和粘贴。同时新增红测试修复上传失败导致原Pane进入failed的问题：粘贴错误在原终端内以可关闭提示显示，socket保持attached；混合File与本机路径的剪贴板在直连入口优先上传File，旧调用默认值不变。实际图片/文字验收待复测。


恢复性错误提示与直连File优先修复后，相关7文件49项/963断言、desktop类型与最终构建通过，初始renderer入口4,623.80kB。复用已有Close/Sending…消息，无新增翻译ID。红日志的DOM断言改为比较布尔值，避免未来失败递归打印React节点。实际复测待记录。


第57轮正确命中目标终端并确认实际焦点，系统剪贴板包含1200×872 PNG；但CDP键事件后没有远端文件，仍未算通过。验收改为在拥有的X11窗口上通过XTest发送真实Control+V，并只读记录浏览器paste事件的格式、文件数量/大小和文本长度；不调用webContents.paste或构造ClipboardEvent作为真实证据。macOS仍保留独立待验证范围。


第58轮在进入剪贴板步骤之前复现工具栏真实位移：测得可用New terminal在x313，Run异步读回后插在它前面，点击原坐标打开Set Run设置。新增组件红测试确认加载前后首个操作从New terminal变为Set Run；将原Run控件移到固定工具操作之后，保留其功能/样式，原按钮位置不再因Run加载改变。聊天粘贴错误同样通过红测试改为可恢复提示，保留会话和输入草稿。相关9文件57项/996断言、类型及构建通过，初始renderer入口4,624.50kB。读取图片的验收使用原filesystem.readFile的bytes/base64合同；实际仍待复测。


第59轮已通过稳定工具栏并进入正确终端，但真实Control+V没有触发paste事件。源码核对发现工作站没有复用原installTerminalKeyEventHandler；它专门负责让macOS Cmd、Windows Ctrl+V及Linux Ctrl+Shift+V绕过xterm/Kitty编码而进入系统剪贴板。工作站复用该安装器及原行编辑规则，暂时注入空全局hotkey解析器，避免吞掉尚未接入工作站的全局动作；旧调用仍使用原解析器。X11验收改为原Linux约定Control+Shift+V。新增三平台纯键盘测试确认不向PTY发按键、不preventDefault，让原系统粘贴链路处理。无账号导入审计仍通过，真实结果待复测。


原键盘模块的barrel还会引入旧keyboardLayoutStore并在导入时订阅未注册的legacy IPC。新增启动审计红测试后，将同一键盘算法提取到纯core，旧模块保留原全局hotkey解析包装，工作站只调用core；不会启动旧IPC订阅。最终11文件64项/1030断言、desktop类型和构建通过，初始renderer入口4,628.01kB。真实X11键盘验收等待服务器处理按键后再关闭测试连接，并保存键事件/paste元数据，仍不以合成ClipboardEvent作为真实验证。


第60轮真实X11 Control+Shift+V已触发浏览器paste事件，但types/files为空；原Linux快捷键经Chromium的Paste and Match Style仅接受文本，系统剪贴板PNG没有进入页面。保留按键和事件诊断。新增红测试后，纯键盘core增加默认关闭的linuxCtrlVPaste选项，仅直连入口启用Ctrl+V的标准浏览器粘贴，避免将Ctrl+V发往远端TUI读取远端系统剪贴板；旧页面的默认键盘语义保持，macOS仍为Cmd+V。重新用真实X11 Control+V验证图片，不能以空paste事件当作上传成功。


Linux标准粘贴选项修复后，11文件65项/1033断言、desktop类型和最终构建通过，初始renderer入口4,628.21kB。旧调用默认仍传递Ctrl+V到终端；直连显式选择标准剪贴板入口，macOS/Windows已有对应平台行为不变。真实图片/中文验证继续。


第61轮真实Control+V图片子流程通过：paste包含实际PNG File，远端图片尺寸/像素hash与本机系统剪贴板一致，远端wc通过粘贴路径读取文件，重复粘贴产生两个文件。截图已查看。随后中文多行文本精确比较失败，原脚本在系统按键提交后立即发送Ctrl+D，未等待异步系统paste默认处理；诊断显示文本事件已到且会话保持attached，但缺少当时文件字节记录，不能直接断言原因已确认。验收改为确认cat重定向文件已创建、实际内容精确匹配后才明确EOF，并无论成败保存有界文件/PTY输出；不增加等待时限。整轮与中文功能仍待复测。


第62轮图片再次通过；诊断确认中文文本实际已经逐字节正确到达远端，3474字节、129个换行、含emoji，SHA-256为c8e7925a786ecb3fe0aa82a044d156040598219e64605c91b8455ccb53edc577。整轮失败是验收误将原readFile默认的bytes/base64合同当作text，直接比较base64与原文；不是文本丢失。修正按返回kind解码并比较精确字节、byteLength和exceededLimit；仍在完整匹配后才结束cat。图片/中文子结果保留，整套仍待复测。剪贴板测试结束时使用原窗格右键Close pane菜单，避免在窄窗格内寻找错误的后代header按钮，不调整布局。


### 客户端系统剪贴板到 SSH 终端实际通过

第63轮冻结源码`e544d4ff86769c82550345bc972ead99f2c3d7b7`整套通过，进程退出码0。系统剪贴板由拥有的Electron实例写入1200×872截图，通过拥有的X11窗口实际Control+V产生Files/image.png的浏览器paste事件，上传PNG约180kB。所选SSH工作区.superset/attachments内的图片尺寸及像素SHA-256与系统剪贴板一致；原xterm.paste只插入转义远端路径，物理Enter后远端wc读取到179926字节。再粘贴同一图片得到独立文件；原图未被替代。未以构造ClipboardEvent或直接产品写API作为真实输入证据。

实际系统剪贴板还粘贴中文、emoji及129个换行到远端cat，文件3474字节、与源内容逐字节一致，SHA-256 c8e7925a786ecb3fe0aa82a044d156040598219e64605c91b8455ccb53edc577。等待只读确认完整内容后再明确EOF，保留原raw字节/PTY诊断。原窗格右键Close pane菜单通过实际鼠标命中操作关闭测试视图，并恢复原焦点与布局。图片路径、真实读取输出、文本与原菜单截图均已实际查看。[第63轮记录和截图](evidence/local-ssh-feature-parity/source-linux-clipboard)。

同轮Run生命周期、统一worktree目录/三个原PTY cwd、项目设置/脚本/图标、文件/Git/设置/多标签/树/Diff/历史/基础分支/分支操作/四同步，以及关闭重开、缩放/拖拽、断线手动恢复、离线、host重启、部分结束、多工作区和daemon丢失完整回归通过。相关65项/1033断言、desktop类型、17语言严格检查和最终构建通过。恢复仍单采样，实际客户端为Linux源码，SSH/Git/系统剪贴板均为拥有的隔离夹具。聊天图片/文件粘贴及晚回复/错误保留草稿已过组件和传输测试，但聊天原生系统粘贴、真实Claude/Codex读取图片、macOS安装包仍待实际验收；不能把远端shell读图当成供应商Agent识图。没有新1.37.7 DMG。窄窗格最小尺寸/裁切的原布局适配仍需继续，完整功能对齐目标未完成。


## 阶段十七：复用创建工作区的 Setup 选择与原终端输出

原PromptGroupAdvancedOptions的Run setup script Label/Switch提取到共同RunSetupScriptOption，旧包装保留原id、默认值、文案及回调。新建项目Worktree显示同一个开关，默认遵循原版开启，可明确关闭；Local检出、旧后端Local回退与独立会话不展示无效选项并提交runSetup=false。工作站不再固定关闭Setup，直接将选择传给原workspaces.create，复用原resolveScript/startSetupTerminalIfPresent和已存在的持久创建收据，没有新增后端API、云依赖或创建时的第二次脚本写入。

创建结果已有Setup终端描述，界面现在用它标注原terminal.list已经存在的资源，Setup标题复用已有翻译。标题只能应用于本次查询返回的工作区资源，不会凭描述创建窗格或终端；重开已有标签不覆盖用户标题、不重发创建。原普通终端、Run与项目脚本编辑器保持复用。

TDD先记录原UI没有开关、固定runSetup=false，以及创建的Setup终端丢失描述标题的失败，再接入。相关6文件23项/911断言通过，原Setup配置/命令解析器53项/64断言通过；desktop类型、17语言严格检查及构建通过。初始renderer入口4,635.16kB。原setup命令/sh文件/cwd解析规则保持，没有改动服务端合同。实际SSH新建执行/跳过、输出、统一目录cwd和窗口恢复不重复执行仍待冻结版本验证；Setup失败状态、Teardown与完整项目生命周期仍需继续。[阶段十七日志](evidence/local-ssh-feature-parity/stage17)。


第64轮冻结4a97e577c实际创建并附着了Setup标题的原终端，但在脚本完成检查前失败于目录断言：先前项目设置已把项目改名并将分支前缀设为remix，实际新路径为统一根目录下的新项目名-完整ID/remix/setup-enabled。旧断言错误要求旧显示名的父目录。截图已查看；验收改为核对同一已验证的Superset Remix/worktrees根目录、完整项目ID后缀及实际进程cwd，允许原项目改名和合法分支前缀。不移动旧工作区，不改服务端命名规则；实际执行与整轮仍待验证。


### 新建项目 Worktree 的 Setup 实际源码窗口通过

第65轮冻结`cd4735b674121dca9c65b61a0de7a6ca3f6f93fa`完整通过，进程退出码0。通过原项目脚本编辑器实际配置Setup，物理选择项目/Worktree并保留原Run setup script开启后，后台创建一个已标为Setup的原终端；可见独立输出SETUP_ACTUAL_OUTPUT，标记文件精确once\n。该PID的实际cwd为当前机器Superset Remix/worktrees/<改名后的项目>-<完整ID>/remix/setup-enabled，正确保留项目改名与原分支前缀；未移动已运行工作区。关闭重开后同一terminalId/executionId/PID保持，标记仍一条，终端总数仍1，确认没有因恢复而重新执行。

再新建相同项目Worktree，物理关闭同一个开关，后台既没有Setup终端也没有标记文件。之后通过原编辑器恢复原Setup配置，通过原标签关闭动作移除两个测试视图，原工作区焦点/布局保持。开关开启/关闭、原终端输出/重开和跳过后的窗口截图已实际查看。保存的编辑器截图对应恢复后的原配置，配置新脚本的物理输入与读回断言保留在冻结脚本及实际终端命令/输出中。[第65轮实际数据和截图](evidence/local-ssh-feature-parity/source-linux-workspace-setup)。

同轮系统剪贴板图片/中文、原Run生命周期、文件/Git/设置/树/多标签/Diff/历史/基础分支/分支与四同步、关闭重开/缩放/手动断线/离线/host重启/部分结束/多工作区/daemon丢失回归通过。此轮仍为Linux源码、拥有的隔离SSH/Git与单恢复采样，不替代macOS发行物或供应商Agent认证。Setup启动失败/脚本失败状态、Teardown、完整预设和其余功能组仍需继续，新DMG尚未生成。


## 阶段十八：复用删除工作区与 Teardown 确认

将原 DestroyConfirmPane、TeardownFailedPane 及其 Enter/IME 规则提为共享纯组件，原入口保留同名导出和默认行为。直连工作区列表增加明确删除入口，使用原 workspaceCleanup.inspect 和 destroyWorkspace 生命周期，保持 Session 文件夹、Worktree 和共享 Local checkout 的原删除语义；未保存或正在保存的编辑草稿先阻止删除。删除成功仅移除同一连接/backend/namespace 下该工作区的所有窗口标签，保留其他机器和工作区。

新增可选 workstationWorkspaceCleanupV1 能力与 destroyTrackedV1，不改变已发布 inspect/destroy 接口。新入口通过原 direct.execute 和主进程持久意图执行；已知 Teardown 失败作为有界结构化结果保存在操作收据中，保留退出码/信号/超时/输出，未知 IO 失败继续进入原核对流程。未提交/未推送的“仍然删除”仍运行 Teardown，只有脚本失败后再次明确操作才跳过。取消、重绘、重开窗口不会由客户端重发删除；同一操作收据在重启后读回不重跑。

TDD 保存缺少入口、缺少组件/处理器及 A→B→A 晚回复的红日志；修复使用作用域 epoch，晚回复不能清理新选择的窗口。最终 desktop 6 文件44项/990断言，host 原清理+收据2文件39项/77断言通过；desktop 类型、17语言严格检查与构建通过，初始 renderer 入口4,669.50kB。此处为组件/原生命周期/传输验证，实际窗口、脚本退出和磁盘删除验收待记录。[阶段十八日志](evidence/local-ssh-feature-parity/stage18)。

第66轮冻结源码 a8bbb4382bfc3f8c144ab0eec1d6560be37174f1，在删除步骤前真实打开已关闭的Setup工作区时复现“Session status unavailable”，截图已查看，未计为删除通过。原因是恢复时的资源匹配标记在离开原工作区后仍有效；B工作区替换了当前检查结果，返回A时旧标记却阻止了新只读查询。新增A→B→A红测试得到A应有状态却仍是B的检查结果，修复为离开恢复资源范围后立即使旧标记失效，重新核对原执行；不创建会话或重跑脚本。45项/995断言通过，实际复测待记录。[第66轮失败证据](evidence/local-ssh-feature-parity/source-linux-cleanup-failures/66)。
