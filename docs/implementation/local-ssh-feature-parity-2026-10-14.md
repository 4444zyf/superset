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

第67轮冻结 b88d4307c 已实际打开同一Setup执行，取消未运行Teardown，脚本exit17后原失败窗显示、工作区恢复；重开窗口marker仍一次，第二次明确删除运行到两次，明确勾选删分支及跳过脚本后目录和分支移除、marker仍两次，原标签移除。截图已查看。随后第二个工作区存在未推送提交，原UI正确显示Delete anyway，而验收脚本硬找Delete，未执行后续删除，整轮未计通过。验收改为读取原inspect结果，按实际警告选择原按钮，不移除风险提示或改变后端语义。[第67轮记录](evidence/local-ssh-feature-parity/source-linux-cleanup-failures/67)。

第68轮冻结 f8fddb584 已通过两个目录实际删除、勾选分支删除/默认保留、marker三次及原Teardown配置恢复。最后重开窗口时，验收在恢复描述符就绪之前立即查询workspace.list，读到undefined，截图显示Reconnecting；没有等待结果，不计整轮通过。验收补上原restore的ready及三原PTY attached的只读就绪判据后再核对marker与工作区列表，不增加等待时限，也不触发产品写入。[第68轮记录](evidence/local-ssh-feature-parity/source-linux-cleanup-failures/68)。

第69轮冻结源码 `cc1429034154d98868b84fb222be757add8b8077` 整套实际窗口验收退出码0。通过原列表实际打开已关闭Setup工作区，同一原执行可附着；原确认框展示未提交和未推送警告，取消后目录保留且Teardown marker不存在。第一次明确删除实际运行Teardown并exit17，原失败窗显示退出码和输出，目录与工作区记录恢复。重开窗口且连接ready后marker仍一次；第二次明确删除运行到两次，勾选删除本地分支后在原失败窗明确跳过脚本，marker保持两次、worktree与本地分支实际移除、保存标签移除。第二工作区选择原警告按钮后成功执行一次Teardown，总marker三次，目录移除且默认保留分支。恢复原Teardown配置，再重开并确认原三个PTY attached后marker仍三次，已删两工作区未重新出现。确认框、失败窗、恢复后三PTY截图已查看。

同轮设置/文件/Git/项目设置/Run/系统剪贴板/Setup，以及窗口关闭重开、布局、手动断开恢复、离线、host重启、部分结束、多工作区和daemon丢失整套回归通过。最终相关 desktop45项/995断言与host39项/77断言通过，类型、17语言严格检查和构建通过，最终初始renderer入口4,669.59kB。[第69轮实际记录](evidence/local-ssh-feature-parity/source-linux-workspace-cleanup)。恢复仍单采样，Linux源码、SSH/Git/PTY和脚本均为拥有的隔离夹具；不代表macOS发行物或真实供应商Agent认证通过。归档/恢复界面、Setup启动/脚本失败状态、瞬时Run可靠自然结束与完整终端预设仍待接入，完整功能对齐目标尚未完成；尚无1.37.7新DMG。


## 阶段十九：瞬时 Run 的明确完成结果

失败测试复现瞬时命令从未被观察到前台进程就返回空闲，旧Run一直active；同时补测跟踪运行缺少完成结果时不能仅凭空闲解锁第二次启动。新增私有完成记录，每工作区一个SHA-256目录、固定result/tmp，目录0700/结果0600、读取最多256字节且拒绝链接/非普通文件；结果包含操作ID与退出码，旧操作的结果不能完成新运行。目录数受原4096条Run记录容量限制，删除工作区后同时清理私有目录和Run记录，晚写入不能重新创建目录。

POSIX系列Shell使用当前交互Shell的eval执行原buildTerminalCommand结果，保持变量和cwd；整个包装为一个命令组，避免其余输入被前台命令消费。长包装自动走原自删除临时脚本传输，复用原shell就绪和命令队列。Bash和Zsh实际进程验证失败退出码、cwd/变量保留、尾部注释与语法错误；其他Shell仍走原行为，未宣称瞬时完成已全部覆盖。Run的JSON记录只增加可选completionTracked/exitCode，不改变已发布API输入。已跟踪运行只有匹配结果、确认退出或明确Stop后才结束，不用时间阈值猜测完成；保持原条件执行ID及停止逻辑。

原Run控件复用，完成后显示Completed或实际退出码；若命令在首次回复前已结束，也附着已有输出终端，不重跑命令。记录客户端失败测试及Shell实现中Zsh对command eval的差异红日志，改用当前Shell的eval。相关desktop6文件47项/1001断言、host6文件55项/125断言通过；类型、17语言严格检查与构建通过。实际窗口验收待记录；不能以这些测试替代真实SSH/PTY运行。[阶段十九日志](evidence/local-ssh-feature-parity/stage19)。

第70轮冻结 `8fce8152637bd711a72d95889439d56bde0d0ee0`，两个实际瞬时Run均foregroundSeen=false，结果正确为0和17，原终端显示独立实际输出，复用同一窗格，marker一次成功一次失败；重开仍同PID且未重跑，三个截图已查看。后续删除验收最后重开时发现第四个已完成Run窗格被补回，整轮未通过，截图已查看。新增红测试确认冷读完成Run不应创建输出窗格，修复为仅本次明确Run的operationId才能在结束后补附着；已保存窗格仍由原布局恢复。同时增加红测试修复完成后才到达的Stop：读到匹配完成结果即返回ended，不向空闲终端发信号。48项/1004断言及host56项/127断言通过，完整实际复测待记录。[第70轮记录](evidence/local-ssh-feature-parity/source-linux-instant-run-failures/70)。

第71轮冻结源码 `43abb525eb588d59b29e9a4c8199800c8cbe37e7` 整套窗口验收退出码0。成功/失败瞬时命令的foregroundSeen均false，原控件显示Completed与退出码17，两个原终端输出分别有独立实际成功/失败行，marker精确once/failed各一次。PID20523/20582；失败输出重开仍同执行、同PID、marker不增加，同一Run窗格复用。关闭完成输出后，后续窗口重开保持原三PTY布局，不再补回完成窗格；相关四截图已实际查看。

同轮原长Run的普通停止保留PTY、强制停止确认原PID消失、重开/host重启同执行，以及系统剪贴板、Setup、Teardown/删除、设置、文件/Git、多工作区和完整恢复回归通过。组件/后端最终104项/1131断言，类型、17语言严格检查和构建通过，初始renderer入口4,670.53kB。[第71轮实际记录](evidence/local-ssh-feature-parity/source-linux-instant-run)。恢复单采样；Linux源码和拥有的SSH/Git/PTY夹具，不是macOS安装包或真实供应商Agent认证证据。Bash/Zsh/sh等POSIX系列完成跟踪已接入，Fish/Nushell等仍保留原执行路径且瞬时完成待补；完整终端预设、Setup失败状态等仍待继续，完整功能对齐目标未完成。


### 阶段二十：原 Setup 执行状态与明确 Ctrl+C（实际窗口待验收）

继续复用原 Setup 配置解析、启动、终端与新建工作区开关，新增可选 workstationWorkspaceSetupV1 能力和只读 workspaceSetup.getStateV1。私有 operations.db 有界记录按 workspace 保存并在删除时清理；POSIX Shell 复用 Run 的私有完成文件，记录真实退出码。启动失败返回可选 setupWarnings；不确定启动保持 Unknown，可读回但不自动重试。原 Setup 输出可通过 Show output 重新附着同一 execution，不新建进程。客户端对晚回复、旧后端和读取错误独立处理。

用户在原终端明确按 Ctrl+C 时，沿现有输入记录该次中断并取消尚未投递的初始命令；不追加信号，不杀父 Shell。只有同一 execution 已无前台进程时才结束中断状态，没有实际退出码就不编造。普通粘贴文本或其他 execution 的输入不取消当前脚本。新增失败测试后实现；实际 PTY 测试使用 Electron Node ABI，5项通过（系统 Node ABI 不匹配的失败日志保留）。桌面核心68项/214断言、视图13项/905断言、剪贴板43项/129断言；host核心68项/139断言通过。host类型检查补正既有测试字面量类型后通过，desktop类型、17语言严格检查及构建通过。

本轮同时复查用户要求的 SSH 图片及其他消息粘贴：保留第63轮真实系统剪贴板/SSH字节与像素证据；聊天粘贴的组件测试通过，macOS发行物和真实供应商 Agent 识图仍待验收。新实际窗口将分别记录成功、失败17、Ctrl+C、原输出重开及恢复不重跑；本段不将尚未执行的验收计为通过。[阶段二十红绿日志](evidence/local-ssh-feature-parity/stage20)。


第72轮实际Linux窗口冻结于 6626bb7fe10e3dab22484d463dbafb4fa7ce9fc2，完整验收退出0。原Setup成功0、跳过无终端/无标记、失败17与同一输出重新打开、窗口重开同PID且标记只一次通过；实际Ctrl+C后显示Cancelled，父PTY仍为PID29392，重开不重跑，未伪造退出码。Run明确Ctrl+C也结束状态并保留PID28758父PTY。成功/失败/Ctrl+C截图已实际查看。

用户要求的粘贴在本轮再次通过真实系统剪贴板+Ctrl+V+所拥有的SSH：PNG1200×872像素哈希 5da154ed7de40907de33ab1f8ab74482298c2766fc5b6cb2b648c9dcb309ae97；远端Shell实际读取、重复图片独立保存；中文/emoji/129换行3474字节SHA256 c8e7925a786ecb3fe0aa82a044d156040598219e64605c91b8455ccb53edc577，逐字节一致。图片未按Enter时路径与粘贴文本截图已查看。原Run/Teardown、文件/Git/设置及整体恢复回归通过。macOS安装包、聊天实际粘贴和真实Agent识图仍未验收。[第72轮证据](evidence/local-ssh-feature-parity/source-linux-setup-status)。


### 阶段二十一：复用原剪贴板附件收集器

新增失败测试复现：SSH终端启用附件上传时，只有 DataTransfer.items 的文件被漏掉；聊天同时存在 files/items 时遗漏 items 中的另一个附件。两处改用原 @superset/ui/lib/clipboard-files 的 getClipboardFiles，合并两个访问器并按原规则去重，避免不同 lastModified 重复上传。原本机终端默认键盘/混合文本行为不变。保留聊天未发送草稿，不因粘贴自动发 prompt；相关桌面8文件57项/1029断言、原收集器6项/8断言、类型与构建通过。

实际窗口增加 --clipboard-only 验收选项，只复测本次有关的系统剪贴板/SSH路径，输出明确标注未跑其余功能。Linux增加真实OS text/uri-list文件格式：有空格/引号/中文文件名、精确字节与远端shell读取；它不替代Finder/真实文件管理器复制验收。新窗口结果待记录，聊天真实窗口、macOS和供应商Agent仍待验收。[红绿记录](evidence/local-ssh-feature-parity/stage21)。


第73轮固定于 7c9938a52962ff6187e8545f780b808a31f97203，实际Linux源码客户端和所拥有的SSH，--clipboard-only退出0。系统Ctrl+V的PNG1200×872在远端按像素校验一致（71fd7782c2a9b9d2a4c85005f221014b9a9c665c6cbcba9bf0fac9b56bd30da9），原Shell实际读取，重复粘贴独立保存。中文/emoji/129换行3474字节再次精确匹配，SHA256 c8e7925a786ecb3fe0aa82a044d156040598219e64605c91b8455ccb53edc577。OS text/uri-list 指向自有36字节文件 clipboard selected '中文'.txt，实际Ctrl+V上传为所选SSH工作区内新路径，逐字节校验通过，再明确Enter由远端cat读取完整两行。原生URI剪贴板文件不等于真实文件管理器复制；未执行聊天原生粘贴、供应商Agent识图和macOS验收。实际文件读取/图片路径截图已查看，清理测试视图后恢复原布局。[第73轮证据](evidence/local-ssh-feature-parity/source-linux-clipboard-collector)。本轮不重复声明全量功能回归，完整第72轮仍单独保留。


### 阶段二十二：原图片预览组件接入本地/SSH文件

RemoteDocumentEditor 按原 isImageFile 分类，将有界 SharedFileDocument 字节传给原 ImageView，复用透明棋盘、键盘/鼠标缩放和平移、复位；未增加文件读取或保存API。非图片二进制保留只读提示，超限文件不能绕过1MiB读取限制。原ImageView按文档ID/文件路径/磁盘revision持有和回收blob URL，切换同名文件不显示其他归属的旧图；损坏图片显示已有翻译 Failed to load image。

先增加两个实际缺失行为的失败测试（图片不能显示、损坏图片无预览入口），再实现。HappyDOM Blob与BunURL实现不兼容的测试失败独立保留；组件测试为URL分配/回收使用逐用例恢复的spy，实际解码留给真实Electron验收。文件与原文档管理回归4文件40项/1091断言、类型、17语言严格检查及构建通过。新的 --file-previews-only 窗口验收准备真实PNG/损坏PNG/未知二进制/超限文件夹具，通过实际文件树打开，测试原缩放/拖动/复位和窗口重开；结果待补充。Markdown、PDF、视频预览仍待接入；Markdown旧wrapper中的偏好/链接/主题依赖需先分离，不能直接引入旧登录启动链。[红绿日志](evidence/local-ssh-feature-parity/stage22)。


第74轮（9b6f1e309396889717e8d49b4ae47f09effb664c）加载、原缩放/平移/复位、损坏/二进制/超限和重开检查退出0，但实际查看截图发现原组件仍裁切底部，所以未将完整图片适配标为通过。新增真实尺寸断言，第75轮（724d0adc4）在同样布局明确失败：图片601.281×436.938，预览区域633.297×318，底部815.938超出区域底部681。修正共用ImageView的有限高度约束与棋盘位置，让完整图片按比例缩小，并追加实际拖窄文件面板后的包含/比例检查。组件4项通过，CSS修正后构建通过；新窗口验收待记录。[初轮和红色证据](evidence/local-ssh-feature-parity/source-linux-file-preview-failures)。


第76轮固定 06b91f7a6537668219c517418451897487208a4a，--file-previews-only 实际Linux/Electron/SSH退出0：1200×872原图显示为393.563×285.984，完整落在633.297×318区域内；实际拖窄面板后显示307.422×223.391，完整落在339.422×318内，两次均保持比例。原键盘125%缩放/箭头平移、来回鼠标拖动及0复位通过；未知二进制无编辑器、超限图保存禁用、损坏图可见错误、重开窗口重新读取并显示通过。标准和窄面板截图已实际查看；未测Markdown/PDF/视频或macOS发行物。[第76轮证据](evidence/local-ssh-feature-parity/source-linux-file-previews)。


### 阶段二十三：原Markdown展示层、编辑与所选工作区资源

先复现SSH文件页没有Markdown默认预览/原源码切换入口的失败测试。提取原TipTapMarkdownSurface和CodeBlockSurface，原TipTapMarkdownRenderer/CodeBlock继续作为旧偏好/链接/主题wrapper，保留调用合同；default/tufte的CSS与展示类共用，代码块、表格、源码格式合并、外部替换清理undo、复制菜单继续复用。修正样式config桶导出会拉入旧tabs/PostHog的依赖，纯展示层改用共享presentation；无账号入口完整依赖审计通过。原FileViewToggle与标签共用，不重新造切换布局。

工作站MD默认预览，源码和富文本使用同一SharedFileDocument；保留front matter、BOM和原格式，busy只读，保存继续CAS原revision。搜索结果打开源代码行；预览查找复用原MarkdownSearch/useTextSearch，并补翻译及可访问名称。当前只接默认Ctrl/Cmd+F与修饰键外部链接，完整自定义快捷键/链接设置仍待接入。外部链接走新增可选本机IPC，并复用原safe-url协议白名单与原sender/frame校验，不接旧云tRPC。

相对图片复用MarkdownResourceProvider/SafeImage/路径解析，通过所选机器filesystem.readFile获取，不误用本机file路径。图片读取器单图1MiB、缓存8MiB/16条、4并发、有界队列与LRU，按MD磁盘revision缓存；换机器/工作区/连接代际后丢弃晚回复，退出时取消排队。未新增后端过程或持久化键。

主回归11文件118项/1431断言通过，后续MD/资源12项/53断言通过（有覆盖重叠，不相加）；原格式往返与链接、图像边界/新revision/晚回复、共享草稿/显式CAS保存/BOM保留均有测试。类型检查、17语言严格检查、相关新代码lint与构建通过；渲染主入口4703.06kB，Markdown动态块2934.50kB。已准备 --markdown-only 实际窗口流程验证双向编辑、保存前磁盘不变、头部/表格/代码格式、SSH相对图片、原查找与窗口重开；尚未把这些待执行项计为通过。未执行OS浏览器打开/macOS发行物验收。[阶段二十三原始日志](evidence/local-ssh-feature-parity/stage23)。


第77轮实际窗口固定e27c3d81b：MD默认预览、SSH图片、源码到预览的草稿、富文本到源码的草稿、明确保存及头部/表格/代码格式断言均走过，随后在Ctrl+F打开查找失败，整轮退出1。截图已实际查看。单元直接向编辑器发键通过；追加焦点在Preview按钮且busy只读的用例复现失败，并追加Escape后焦点丢到文件外的失败。将默认查找快捷键捕获范围移到当前文件tabpanel，关闭查找恢复同一文件焦点，不绑定到窗口的其他工作区。单元红9通过/2失败后变为11通过；相关MD/资源/启动审计共16通过/1054断言，类型、相关lint和重建通过。新实际窗口待执行；第77轮不算完整通过。[第77轮失败证据](evidence/local-ssh-feature-parity/source-linux-markdown-failures/77)。


第78轮固定085e9fa59511b52e4fc1ca4ee5d2f4d4e6b0e294，实际Linux/Electron/SSH --markdown-only退出0：默认原TipTap预览/原切换控件、原表格/代码块、1200×872 SSH相对图片的blob显示通过；在源码和富文本中分别实际输入中文/emoji，另一视图立即看到同一草稿，两次编辑后保存前磁盘仍与原文件完全一致。实际点击Save后，磁盘225字节文件包含两份编辑、front matter逐字保留、表格和代码源码格式不变。原查找1 of 1、Escape后重新Ctrl+F以及窗口重开读取已保存正文通过；Search和重开截图已实际查看。OS外部浏览器及macOS发行物未验收，完整自定义快捷键/链接设置及全局退出草稿保护仍在清单中。[第78轮证据](evidence/local-ssh-feature-parity/source-linux-markdown)。


### 阶段二十四：原PDF/视频文件视图

先增加失败测试，复现PDF与WebM仅显示二进制提示；RemoteDocumentEditor复用原PdfView/VideoView和类型分类，通过已有SharedFileDocument字节预览，不新增后端接口。保留只读/1MiB界限、原生视频控件与metadata预加载、默认不自动播放，文档身份变更卸载旧blob。组件测试对HappyDOM中无实际浏览器的iframe导航仅逐用例关闭其自动加载，结束恢复设置；实际PDF内容不能由这个结构测试代替。文件相关4文件49项/1290断言、格式化工具21项/38断言、类型、17语言及构建通过。Markdown查找数字改走原formatNumber，现有消息ID和翻译继续使用。

新增 --media-only 实际窗口流程，拥有的夹具生成可审查的PDF和FFmpeg testsrc2 WebM/MP4，不给产品增加FFmpeg依赖。读取/校验SSH字节、记录PDF帧与可访问树并截图；PDF必须另经截图实际查看，iframe加载不等于页面验证。视频使用可见原生播放按钮检查时间推进/暂停、默认与重开不自动播放，并核对超限文件不能加载播放器。新窗口结果待记录，macOS/其他容器和编码格式尚未验收。[阶段二十四日志](evidence/local-ssh-feature-parity/stage24)。


第79轮固定39d4860da：PDF字节校验/iframe真实load通过，截图已实际查看，页面确实显示 Superset Remix SSH PDF 和 Selected remote workspace 两行；PDF插件可访问树未提供正文，因此不能用AX冒充文本断言。WebM元数据/首帧/控件与不自动播放通过，随后播放检查超时，整轮退出1。查看截图发现验收坐标点击了底部进度条而非上一行的播放按钮，产品视图未改；定位优先使用原生控件的AX/BoxModel，保留经截图核对的控件位置备用，并追加播放时间及至少2帧、暂停检查。新窗口待重跑。[第79轮原始证据](evidence/local-ssh-feature-parity/source-linux-media-failures/79)。


第80轮固定f246a77d990462bc0bc0d8be1d91ec8cd14d9a0d，实际Linux/Electron/SSH --media-only退出0。PDF页面截图已实际查看，两行标题/正文正常显示；原始AX正文不可见的记录继续保留，人工查看单独记录。WebM与H.264 MP4均由真实原生控件开始播放，时间分别推进至0.208880/0.207399秒，已解码4帧，随后真实点击暂停，时间分别0.448995/0.447977秒、5帧且paused=true；并非仅验证metadata。MP4播放截图已查看。超限文件不创建播放器且禁用保存，截图已查看；窗口重开恢复视频仍从0秒暂停、不自动播放。原始字节hash、控件AX定位方法与播放前后状态均归档。未验收macOS发行物、其他容器或编码格式；全量文件监听、快捷键和全局退出草稿保护仍待接入。[第80轮证据](evidence/local-ssh-feature-parity/source-linux-media)。


### 阶段二十五：聊天系统剪贴板与实际分屏布局

用户要求检查客户端向SSH机器粘贴图片、文件和文字。在原终端第73轮实际传输结果之外，追加 --chat-clipboard-only 流程：只通过系统剪贴板和真实粘贴键操作聊天输入框，通过所选SSH后端的附件读回与拥有的夹具目录核对字节/像素；检查重复附件独立ID、中文多行文字草稿、未明确Send前没有用户消息或turn、切换会话隔离、重开附件仍可读。该流程不冒充供应商模型发送或识图。

第81轮固定c1fdb016b，第82轮固定4bd003a7f，均退出1：原3个PTY分屏中新建聊天后的真实窄窗格中，输入框y=985.5、高56，超出872高窗口，尚未到达粘贴步骤。第82轮截图已实际查看；未通过改布局来规避。修正聊天展示层的有界flex高度，使历史/会话选择/附件可以滚动、输入区保留可用空间；窄窗格表单换行并允许文本框收缩。上传、发送、协议及原有隔离逻辑不变。相关4文件40项/112断言与类型检查通过；新真实窗口复测待记录。[原始失败证据](evidence/local-ssh-feature-parity/source-linux-chat-clipboard-failures)。


第83轮固定5e07290c5，第84轮固定9ca835739，均退出1。纵向输入区已回到y=801，但增加的真实祖先裁切/hit-test断言仍失败：textarea宽163.296875，仅73.90625可见且中心点落在相邻窗格。第83轮截图已查看，第84轮祖先几何显示原Pane仍260px最小宽，而所在子分屏只有348.90625px，两个最小宽度面板无法放下。没有调验收布局或移除原Pane最小尺寸。

按原尺寸和真实容器尺寸判断布局能否放下，放不下时使用工作站已有紧凑窗格切换，保留原树/比例/资源记录。继续复用@superset/panes原引擎，并导出原尺寸常量供判定复用；ResizeObserver测量网格容器，容器增大可恢复原多窗格。新增回归先2通过/2失败，随后5通过/9断言（含原资源替换测试）；剪贴板与窗格共6文件45项/121断言通过。真实窗口流程追加4窗格切换入口、完整输入区可见及原3个PTY同PID/执行ID/工作目录检查；实际结果待记录。


第85轮固定b5395782ea05aaae4cb2465829ad122f8576b103，实际Linux/Electron/SSH --chat-clipboard-only退出0。相同原3个PTY布局中新建聊天后自动使用已有4窗格切换，textarea宽847.296875、高56，系统粘贴前均通过完整祖先裁切和中心命中检查。真实Ctrl+V产生4个trusted事件：3474字节中文/emoji/129换行文字草稿精确匹配；两次PNG分别为独立附件ID、85981字节且hash相同，SSH后端存储与下载读回均核对、像素1200×872一致；URI文件包含空格/引号/中文，41字节精确读回。原3个PTY在紧凑切换和重开后仍为PID50476/50489/50483、同执行ID和统一worktree目录。新会话未带入旧文字/附件，重开后附件可读；两会话的真实journal均无用户消息/turn，未自动发送。附件和重开截图已实际查看。[第85轮证据](evidence/local-ssh-feature-parity/source-linux-chat-clipboard/85)。

这些结果只验证聊天草稿和SSH附件传输。实际窗口同时显示旧Codex启动错误：已安装CLI为0.159.0-alpha.3，当前host要求0.160.0；错误提示却因首次prompt前notice的turnId为空变成Zod校验错误。新增启动失败回归先8通过/1失败，复现同样turnId错误；改为与原live-session失败路径相同的有界事件身份生成，保留真实CLI错误且不创建turn。Codex相关3文件20项/96断言通过，实际窗口需继续验证真实版本原因。源码还确认旧Codex harness目前会省略附件；附件上传成功不代表已发送给模型。ACP原生输入/附件投递、真实供应商发送与识图、Finder复制和macOS发行物仍待完成，不能以本轮替代。


第86轮固定ecfa7b7377dbe95be9d17eb162a06dbe5ebc1978，实际Linux/Electron/SSH增加 --expect-codex-version-rejection 后退出0。真实旧CLI启动错误现完整显示“codex 0.160.0 or newer is needed for chat, and 0.159.0-alpha.3 is installed”，不再被空turnId的Zod错误替换，未升级或伪装CLI/供应商登录。文字草稿、两份82575字节PNG的像素/下载读回、41字节URI文件、会话隔离、无自动发送、重开及原3个PTY保留再次通过。附件、重开和About截图已实际查看。原附件省略、明确Send/供应商识图及macOS边界仍如上一段所述。[第86轮原始证据](evidence/local-ssh-feature-parity/source-linux-chat-clipboard/86)、[阶段二十五回归和构建日志](evidence/local-ssh-feature-parity/stage25)。

用户最新要求的原版风格图标已接入：原四枚像素括号、纯色深底、浅紫内侧括号；SVG为唯一几何源，派生PNG/ICNS/ICO/托盘/侧栏/About/安装背景，31项字节一致性及16/32/128/1024透明角检查通过。第86轮实际侧栏/About、最小窗口、退出/重开通过并查看截图；这仅是Linux源码窗口，未制作新的macOS安装包。原版权与许可继续保留，历史发布证据不改写。


### 阶段二十六：原Codex/Claude聊天附件编码与失败恢复

新环境重新检出默认分支后，恢复到已推送的release-local-ssh-feature-parity-1.37.7/8cca237bb，重建匹配此分支的PTY类型声明。新增两个失败测试确认：Codex RPC只含文字、Claude SDK只含文件名。通过可选附件解析器接入原适配器：Codex使用原协议image数据URL，Claude使用SDK图片块，PDF走SDK文档块，其他文件传递所选后端的可读路径引用；文字/顺序/原text_elements保留，客户端MIME不覆盖后端元数据。未提供解析器的旧调用合同保留；这是现有两个harness的修补，不将它们冒充ACP原生输入。

读取器提取并复用原HTTP下载的私有目录/UID/权限、UUID、元数据/负载文件身份、硬链接/符号链接与25MiB检查，异步有界读取并支持AbortSignal。共享附件准备器按16个文件/整批25MiB约束、顺序解析；任一附件不可读则整条消息不投递，不静默丢弃。取消会丢弃旧读取，新的输入不被旧Promise阻塞；适配器结束会停止准备并释放排队数据。读取失败或取消在agent调用前使用内部inputNotDelivered标记结束该输入，修复尚未出现running turn时后续输入永久排队的问题；该标记不进入网络协议，也不把未知RPC结果标为未执行。此生命周期回归先3通过/1失败，再通过。

新可选workstationChatAttachmentInputV1从后端到主进程/客户端贯通；旧后端禁用新附件发送但仍允许历史附件下载。Send拒绝只显示当前会话错误，保留文字与附件草稿；组件先16通过/2失败再通过。继续复用原剪贴板大小校验和翻译，限制已有草稿与新粘贴/选择合计字节，避免逐个文件均合法却整批超限；新增选择预算用例先18通过/1失败再通过。客户端相关5文件71项/206断言、无账号依赖审计1项/1005断言通过，runtime/host/desktop类型与17语言严格检查通过。

扩展主线程阻塞检查发现5个既有文件legacy-import/legacy-sources/legacy-v1/process-lock/run-completion的同步清理违反ratchet；在未修改的8cca237bb归档源码中单独复现同样3通过/1失败，未提高允许计数，也不把完整扩展套件算通过。附件读取本身没有新增递归同步操作；既有清理问题继续留在整个对齐目标内。新增真实窗口验收参数将实际点击Send，确认当前0.159 CLI被真实版本门槛拒绝时保留草稿与附件，并检查重开无自动发送、原3个PTY仍保留。SDK消息编码目前为类型化协议夹具，真实供应商识图/登录与macOS仍须另验。

第87轮固定7d20fac72，实际发送被0.159 CLI启动失败拒绝，文字及图片/文件草稿仍在；验收按钮定位将历史附件也计入，4对2，退出1。截图已实际查看，脚本改为只计草稿附件行。第88轮产品仍7d20fac72/脚本0ef6c5ecb，明确Send后的文字、两图片与文件均保留、远端仍只有3份附件且journal只有1条手动消息、无turn，随后New chat因原有未确认操作被拦截，并错误地让整个聊天窗格进入失败占位，退出1，失败截图和草稿截图均已查看。不能因版本错误就将未知执行结果自动清除，保留远端unresolved与本地pending防重发。新增同一路径回归先18通过/1失败，New chat拒绝改为当前会话内错误后19通过/76断言。实际脚本在Send前创建第二会话，Send后核对未确认操作仍在、新建拒绝不丢草稿，再切换已有会话检查隔离及重开，避免把“未知执行可自动继续”当成验收目标。[第87/88轮原始失败证据](evidence/local-ssh-feature-parity/source-linux-chat-input-failures)。

第89轮固定715cb942e，Send拒绝和全部草稿断言通过后，journal身份校验失败：原会话列表在新建/刷新后排序改变，脚本将codex #1误认为最早会话，实际明确Send落在另一个已选择会话。失败截图已查看；改为用持久化窗格resourceId核对真正选择身份，仍只通过可见按钮切换，不通过内部API修改状态。第90轮产品715cb942e、脚本5f912722b，实际Linux/Electron/拥有的SSH --chat-clipboard-only --expect-rejected-chat-send退出0。系统Ctrl+V的3474字节中文/emoji/129换行精确匹配；两份独立ID的83473字节PNG下载与远端存储hash相同、像素1200×872一致；41字节含引号/中文文件精确读回。明确Send被真实旧CLI拒绝后，文字/两图片/文件草稿完整、没有重复上传，journal仅1条手动消息且无turn。继续New chat被既有pending操作阻止时仅显示当前会话错误，草稿仍在；只读inspectPending确认chat.prompt仍unresolved，不自动清除、重放或冒充未执行。切换已有另一会话草稿为空，重开无自动消息，附件仍可下载，原3个PTY同PID6039/6052/6045、执行ID及统一worktree目录保留。拒绝后草稿与重开截图已实际查看。最后相关客户端/主进程/操作日志50项165断言、类型与重建通过。[第90轮原始证据](evidence/local-ssh-feature-parity/source-linux-chat-input/90)、[阶段二十六红绿/回归/构建日志](evidence/local-ssh-feature-parity/stage26)。这不替代真实供应商发送/识图、ACP原生输入或macOS发行物；既有同步清理ratchet失败继续处理。

### 阶段二十七：移除既有递归同步清理

阶段二十六暴露的主循环检查在本阶段修改前再次3通过/1失败，仍是相同5个文件，未修改ratchet或提高计数。将legacy-import/legacy-sources/legacy-v1的递归删除改为node:fs/promises.rm；导入恢复、历史归档及全部调用者等待清理结束，再继续发布/回滚或释放现有进程锁。RunCompletionStore目录清理改为await，工作区删除的Run/Setup状态清理均等待后再删状态记录，错误继续由原warning路径处理。进程锁只操作单个符号链接，改用unlinkSync；prepare也仅unlink固定result.tmp，仍只忽略ENOENT。没有将递归删除换名或移入豁免目录，tRPC输入/输出/错误合同不变。相关12文件83项253断言、host/desktop类型与单独Node静态历史FIFO用例通过；原7项history归档和恢复回归仅改为等待异步清理。新增--lifecycle-only复用已有瞬时Run、Setup与Teardown/删除实际窗口流程，结果待记录。

第91轮固定e569fae2844bd1aafe98930c6176e14fe9154644，实际Linux/Electron/拥有的SSH --lifecycle-only退出0：原编辑器配置瞬时Run分别真实退出0/17、输出保留、同输出重开及Ctrl+C不结束父shell；Setup明确启用/跳过/失败17/取消，重开仍同PID/执行ID且不重跑；原删除影响确认、取消不删、Teardown失败17/重开、明确跳过不运行、成功只运行一次、2个Worktree及保存标签删除、勾选分支删除与默认分支保留均通过。原3个PTY仍PID7743/7749/7755，最终原布局和配置恢复。失败Run、Setup取消和删除后重开截图均已实际查看。原主线程4条ratchet检查全部通过，先前5文件递归同步清理失败已处理，未改豁免或允许计数；不将这称为所有既有同步文件读取均已消除。[第91轮原始证据](evidence/local-ssh-feature-parity/source-linux-cleanup-async/91)、[阶段二十七回归/类型/构建日志](evidence/local-ssh-feature-parity/stage27)。macOS发行物、供应商Agent验证及总清单其余入口仍按原范围继续。

### 阶段二十八：原文件事件总线与外部变更

新增失败回归先35通过/2失败：工作站SocketBroker拒绝原/events、RemoteFiles收不到原fs:events。将原workspace-client事件总线的订阅/引用计数/分发/状态与清理提取为可注入传输的纯核心；原getEventBus继续使用同一relay/token包装与参数，原12项真实WebSocket测试通过。工作站使用现有主进程IPC和已验证连接连接原后端EventBus，不向renderer暴露令牌或建立云账号。新增可选workstationFileEventsV1，仅字面true开放，旧后端继续原手动刷新。主进程只增加精确/events路径，不接受附加token或其他变形路径。

复用原watchFs/watchFsFile，工作区递归监听与已打开文件的忽略目录兜底均按原引用计数释放；断线只恢复读取订阅，不重放写入。新的IPC适配层按连接/后端/namespace/generation与socket ID隔离，晚打开/晚错误丢弃，重连只保留一个定时器，未连接不排队。仅接受有界文本事件；工作区与根路径校验、异常批次转overflow、重连后原文档重新核对。文件树保留原Pierre引擎，事件刷新串行合并，连续变化最多保留一个待刷新标记；工作区切换后的旧事件不影响新视图。更新走原SharedFileDocument：干净文档重读、未保存草稿保留、不隐式保存。另一个回归确认stat丢失类型的目录rename/delete未影响已知子文档，补齐基于已打开路径的目录判断；原OrphanedBanner接回工作站，先13通过/1失败，后14通过，丢弃仍仅由明确按钮触发。

客户端相关8文件98项1479断言，包含无账号启动链对纯事件核心的审计、旧后端/非法路径/切换隔离/引用计数/监听关闭与原编辑器回归；后端事件及原4条阻塞规则共11通过；workspace-client/host/desktop类型与17语言检查通过。新增--file-events-only将从拥有的SSH夹具运行机执行外部文件写入，核对真实事件与原树/编辑器、脏草稿冲突、忽略目录已打开文件、目录删除以及重开和原3个PTY。原冲突比较/解决对话框、全部文件内联操作、Markdown相对图片单独资源的监听及全局退出草稿提醒仍须继续接入，不能将本阶段称为整个文件组已完成。

第92轮为明确旧构建基线：产品仍是阶段二十七e569fae28的未重建bundle，脚本17a2568d1。拥有的SSH运行机外部写入external update后，原编辑器仍显示external original，原事件观察为空，按预期退出1；失败截图已实际查看。记录旧bundle字节hash，随后才重建，不能把此轮算成新代码验收。[旧构建基线](evidence/local-ssh-feature-parity/source-linux-file-events-baseline/92)。继续检查发现原后端的监听流失败会通过正常socket发送type:error，新传输也须重订阅，不能停在表面open；新增失败回归后补齐只读订阅重连，未改变后端消息合同。

第93轮固定ed3b8f822，新构建实际窗口已走过：外部内容更新自动出现在原编辑器、目录create/rename/delete出现在原树，rename事件含原路径和目录类型，原删除提示可见；真实用户输入草稿后外部修改，明确Save被原版本条件拒绝，草稿和远端新内容均保留。随后脚本期待“Close file and discard draft”后再出现确认对话框而超时，退出1；该控件本身就是明确丢弃，只有标签关闭使用另一个确认流程。修改脚本等待明确丢弃完成，产品合同不变。自动更新、冲突与失败截图已实际查看。忽略目录文件和最终重开尚未走到，不能算本轮通过。[第93轮失败证据](evidence/local-ssh-feature-parity/source-linux-file-events-failures/93)。

第94轮产品仍ed3b8f822、脚本ceedd5f7c，原外部修改/目录/冲突与明确丢弃通过；.gitignore排除目录中的已打开note.txt真实外部更新也自动显示，截图已实际查看。重开后目录和子项均显示，但open目录helper错误地等待CodeMirror，尚未点击子文件就超时，退出1。失败截图已查看；目录操作改为仅展开，文件操作才等待编辑器，产品不变。[第94轮失败证据](evidence/local-ssh-feature-parity/source-linux-file-events-failures/94)。

第95轮产品ed3b8f822、脚本e39924e42，实际Linux/Electron/拥有的SSH --file-events-only退出0。外部写入来自夹具的SSH运行机文件系统，事件走真实后端原EventBus和客户端IPC，非renderer变更API或供应商Agent。原CodeMirror自动看到包含中文/emoji的外部新版本；原Pierre树自动显示目录新增/重命名/删除，目录rename使已打开child.txt自动跟随新路径，删除后原OrphanedBanner显示且内容保留。真实键入未保存草稿后外部再改，明确Save触发原版本冲突，草稿及远端新版本均未被覆盖；按原明确丢弃按钮关闭后，.gitignore排除目录中的已打开note.txt仍通过原watchFsFile收到更新。重开后正确读取新内容、没有自动写回，3个原PTY同PID15295/15307/15301、执行ID与统一worktree cwd保留。原始观察含6批create/update/rename/delete事件，自动更新、删除、冲突、忽略目录和重开截图均已实际查看。[第95轮原始证据](evidence/local-ssh-feature-parity/source-linux-file-events/95)、[阶段二十八红绿/回归/类型/构建日志](evidence/local-ssh-feature-parity/stage28)。真实断网恢复与晚回复隔离目前仍是确定性注入回归；当前监听生命周期附着在文件视图，后台文档与Markdown相对图片独立资源、原完整冲突比较/解决UI、其他内联操作及全局退出草稿提醒继续接入。Linux源码窗口不代替macOS发行物。


### 阶段二十九：原文件冲突比较与明确解决

复用原FileSaveConflictDialog的全部布局、默认Keep editing焦点和三个动作，将其提取为可注入Diff的纯Surface；旧入口继续包裹原LightDiffViewer，工作站注入原LightDiffSurface及当前主题/字体，不拉入云设置。原ExternalChangeBanner.Compare、SaveErrorBanner.Retry/Dismiss同时接回，冲突与保存失败使用文件内原反馈，避免解决后遗留顶部全局错误；其他Git等错误继续原全局路径。对话框先28通过/1失败，旧全局反馈独立复现28通过/3失败，修复后相关界面32通过。删除的干净文件先被Save按钮错误禁用，失败回归后允许明确保存；测试中的异步Overwrite交互改为await act等待React提交，未增加超时或真实等待，最终相关六文件73项1444断言全部通过。

Overwrite只通过工作站明确冲突动作签发一次性许可，绑定连接generation、文档ID、路径、工作区和草稿字节；普通force调用仍拒绝。先读取所选后端已有getMetadata，再以最新revision执行原CAS；symlink使用有界目标读取获取实际revision。不存在的文件使用原原子create/no-overwrite，竞态EEXIST恢复原冲突。后端切换后的晚metadata不发送写入，写入期间新收到的delete不会被晚成功回执抹去。原文档store在没有新事件时清除已明确恢复文件的orphaned标志，不合成可能覆盖真实删除的create事件。旧后端无workstationFilesV1时禁用覆盖并显示已有能力提示。没有改变tRPC或后端合同，CRLF等原草稿编码继续保留。desktop类型、17语言、插件及桌面3条阻塞规则通过。

第96轮产品仍ed3b8f822，脚本f996121dd，尚未到冲突验收就因严格鼠标选择器遇到刚保存后暂时禁用的Close控件而退出1；截图实际查看，修正为等待可见且启用，仍拒绝隐藏/被遮挡控件，不把本轮计为功能基线。第97轮产品仍同一未重建ed3b8f822、脚本922264d04，真实系统键入本地草稿后SSH运行机外部修改，草稿保留，但没有原外部变更Compare入口和冲突对话框，按预期退出1；失败截图实际查看。保存旧bundle字节hash后再重建，[旧构建基线](evidence/local-ssh-feature-parity/source-linux-file-conflict-baseline/97)、[第96轮脚本失败](evidence/local-ssh-feature-parity/source-linux-file-conflict-failures/96)。新版实际窗口结果待记录，不能由组件测试推断macOS或供应商Agent验收。


第98轮固定922264d045fd4f31a81e9a5faf941cd6bc5dc9a5，重建后的真实Linux/Electron/拥有的SSH --file-conflict-only退出0。原Diff实际显示远端内容与中文/emoji草稿两侧；Keep editing两份内容不变，只有明确Reload读取远端版，明确Overwrite保存本地草稿且磁盘CRLF保留。文件真实unlink后原删除提示保留草稿，明确Save/Overwrite恢复文件。目录真实chmod 0500导致EACCES，原SaveErrorBanner出现且草稿、磁盘旧版均保留，恢复权限本身不写入，只有明确Retry才保存并清除错误。关闭/重开后读取已恢复内容且没有自动写入，原3个PTY仍PID19489/19502/19496、执行ID和统一worktree cwd保留。八张冲突/重载/覆盖/删除恢复/错误重试/重开截图均已实际查看。[第98轮原始证据](evidence/local-ssh-feature-parity/source-linux-file-conflict/98)、[阶段二十九红绿/回归/类型/构建日志](evidence/local-ssh-feature-parity/stage29)。背景文档与Markdown独立图片资源监听、其他内联操作和全局退出草稿提醒继续完成；本阶段不将整个文件组或macOS发行包标为完成。


### 阶段三十：后台文档及Markdown独立图片事件

先复现没有文件视图时打开的文档不再订阅，失败回归后在工作台中复用原事件hook为保留文档拥有订阅；按实际连接/后端/namespace/generation/工作区隔离，仍是同一原EventBus的引用计数，不重复递归后端监听。文件视图继续负责树与图片刷新，正常共享文档由工作台分发一次，切到Terminal/Chat仍监听已有文档；断开或换后端释放，generation更新通知原文档订阅者并重建只读订阅。对同后端generation恢复的回归先失败后通过。后台干净文档更新、脏草稿保留/外部变化提示、旧连接事件拒绝和0写入均由注入原IPC事件的回归确认。

Markdown继续复用原SafeImage/MarkdownResourceProvider及现有有界读取器。仅图片变化时失效相应缓存，并把资源revision传给原预览；编辑器和草稿不重新挂载。等待读取的旧字节立即被拒绝，晚回复不填回缓存；删除或缺失图片仍保留最多16个路径关注，后续create可重读，继续原单图1MiB/总8MiB/16项/4并发边界。原watchFsFile同样覆盖.gitignore目录中的图片，不依赖Markdown源文件revision改变。相关回归先4通过/2失败，后6通过；首次测试将未完成promise直接交给Bun同步rejects断言导致测试进程阻塞，已终止，改用Promise.allSettled观察后才复现功能失败，未提高超时。最终8文件83项1493断言、desktop类型及17语言检查通过。PDF夹具保留既有happy-dom禁用iframe加载的NotSupportedError诊断，不能将其算真实PDF页面加载；真实PDF已有第80轮独立证据。

第99轮产品仍未重建922264d04、脚本8b758e8fb，实际进入原终端后文件树已卸载，SSH运行机外部目录rename未传到客户端，原观察只有之前的create事件，按预期退出1；失败截图已实际查看，旧bundle hash保留后才重建。[第99轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-background-files-baseline/99)。新版后台目录跟随、草稿保留、独立图片更新/删除/恢复与重开实际窗口待验，不能从协议夹具推断供应商Agent或macOS行为。


第100轮固定8b758e8fb，真实终端视图中已收到目录及子文件rename，返回文件视图原文档跟随新路径；随后脚本未等待加载完成/CodeMirror可编辑就键入，预期草稿没有出现而退出1。失败截图已查看，保留产品不变，只在脚本中等待contenteditable=true并确认真实焦点；不把这一轮算全部通过。[第100轮失败证据](evidence/local-ssh-feature-parity/source-linux-background-files-failures/100)。第101轮产品仍8b758e8fb、脚本b006af752，实际Linux/Electron/拥有的SSH --file-background-only退出0：文件视图卸载、终端仍显示时真实目录rename已经到达，返回后原文档自动跟随；中文/emoji草稿在再次离开后的外部修改中保留，原外部变更Compare提示出现，远端新内容未被写回。Markdown引用.gitignore目录中的PNG，源文档不变时实际128×128图片更新为32×32及新blob，unlink显示原Could not load image，重新创建24×24后自动恢复。关闭/重开仍显示24×24、两个源文件字节保持正确，3个原PTY仍PID22882/22894/22888、执行ID和统一worktree cwd保留。八张后台目录/草稿/图片更新、删除恢复与重开截图均已实际查看。[第101轮原始证据](evidence/local-ssh-feature-parity/source-linux-background-files/101)、[阶段三十红绿/回归/类型/构建日志](evidence/local-ssh-feature-parity/stage30)。其他文件内联操作/拖拽/完整快捷键、全局退出草稿保护及总清单其余组继续接入；Linux源码窗口不代替macOS发行物。


### 阶段三十一：原未保存更改对话框与窗口/退出保护

复用原UnsavedChangesDialog，保留Cancel/Don't Save/Save All的动作与加载状态，补齐原Cancel/Saving的已有翻译，并用可选details展示有界滚动路径列表和真实保存错误。工作站从原共享store收集所有后端/工作区的脏文档与待完成保存；即使文件视图已关闭仍受保护。Cancel只拒绝关闭，Don't Save只明确允许关闭而不重读/改写文件，Save All逐项执行原CAS；失败/冲突保留原草稿及对话框，不自动覆盖。待完成写入时禁用继续关闭，旧视图卸载取消其挂起请求。纯界面回归先2失败后通过，新增干净文档/卸载回归也通过。

客户端主进程、同一受限preload与renderer新增仅本机IPC握手，不改变任何后端tRPC或云协议。注册ID和请求ID均为一次性UUID，绑定实际窗口owner及导航epoch；重复window/quit共用一个请求，旧owner/旧注册/重复回复不能批准关闭，导航、卸载或renderer退出会拒绝挂起请求。新gate先2失败，另一个错误owner请求先失败后修正为拒绝。尚未挂载工作站的窗口按原启动/失败关闭行为处理；已注册的窗口在得到明确结果前不做views.invalidate、disconnect或退出清理。相关6文件35项1167断言、desktop类型及17语言检查通过，原桌面3条阻塞规则也包含在内。

第102轮产品仍未重建8b758e8fb、脚本2b13262d6，实际输入草稿并切到原终端后BrowserWindow.close直接销毁旧renderer，没有原草稿对话框，后续CDP读取超时，退出1。关闭前终端截图已实际查看；renderer已消失，因此没有关闭后截图，不伪造为已捕获。保存旧bundle hash后才重建。[第102轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-close-guard-baseline/102)。新版真实取消/合并关闭请求/明确Save All/冲突/Don't Save和重开结果待记录。本阶段是文件草稿的窗口/退出保护；聊天草稿、Reload及其他未接入口继续分别核对，不冒充OS强制结束或macOS实测。


第103轮固定2b13262d6，真实窗口已通过原草稿提示、Cancel及window/quit重复请求只出现一个提示、明确Save All保存CRLF后退出和重开；冲突也确实阻止退出，保留草稿与远端新版。随后返回Files时原冲突对话框自动显示，脚本却重复点击被对话框挡住的文件树，超时退出1。四张提示/保存重开/冲突及失败截图已实际查看；修正helper使用已打开的活动文档，产品不变。[第103轮原始失败](evidence/local-ssh-feature-parity/source-linux-close-guard-failures/103)。第104轮产品仍2b13262d6、脚本0607413f2，实际Linux/Electron/拥有的SSH --file-close-guard-only退出0：后台终端视图下原关闭保护出现，Cancel保留窗口/草稿/连接；同时window.close和app.quit合并一个提示且取消后仍可编辑；明确Save All才保存中文/emoji及原CRLF并退出，重开读回正确。第二份草稿遇到外部新版本，退出Save All被原CAS拒绝，提示保留具体冲突，Cancel后原文件Diff及Keep editing仍保留完整草稿；明确Don't Save才关闭，重开只有远端新版本且无自动写回。两次重开后原3个PTY仍PID27113/27125/27119、执行ID及统一worktree cwd保留。七张原提示/保存重开/冲突/草稿/明确丢弃及重开截图均已实际查看。[第104轮原始证据](evidence/local-ssh-feature-parity/source-linux-close-guard/104)、[阶段三十一红绿/回归/类型/构建日志](evidence/local-ssh-feature-parity/stage31)。本次用拥有的BrowserWindow.close/app.quit生命周期事件触发关闭，实际键盘及按钮完成操作；不将其称为物理OS菜单、强制结束或macOS发行物验证。聊天草稿、Reload、完整快捷键、终端预设和总清单其余功能继续核对。


### 阶段三十二：原草稿写入器与私有SQLite聊天草稿

真实失败回归确认：另一会话确实隔离了草稿，但返回原会话会丢掉文字和附件引用。提取原useComposerDraft的300ms防抖、待保存缓存、失败保留及离开时flush为可注入持久化和定时器的ComposerDraftWriter；原入口仍用相同localStorage读写/恢复语义，原4项回归全部通过，工作站不新增localStorage写入。异步保存改为单个在途写入、每个键只保留最新值，迟到成功不删除新值；新编辑才继续或明确flush重试，不无限重试失败快照。

工作站草稿按connection/backend/namespace/workspace/session隔离，generation更新保留同一会话草稿；使用本机应用私有chat-drafts.db，文件0600、单独SQLite表，不接Superset账号、云数据库或第三方消息接口。最多32份草稿、单条文字UTF-8 1MiB、总8MiB、每条16个附件且引用的总文件大小继续25MiB，只存文字和opaque附件元数据，不复制图片文件或凭据。快照revision/CAS阻止旧写入复活已明确清空的草稿；非法旧数据报错并拒绝覆盖。晚回读与期间输入合并，后台工作台保留草稿，重开读取已存版本，恢复不调用upload/prompt。仅收到手动Send成功回复后清空对应草稿；发送拒绝或未知结果继续保留。已有双剪贴板附件回归也发现新适配层使用旧闭包丢掉前一个上传，已改为基于当前草稿追加，原19项聊天回归通过。

窗口关闭/退出在批准前先等待本地草稿flush；持久化失败显示原未保存对话框，Cancel保留内存，Save All明确重试，Don't Save才可放弃。补齐两个失败回归：卸载后的晚读取不能批准旧窗口关闭，Save All等待聊天存储后对话框已卸载不能继续发起文件写入。最终相关9文件53项1256断言、desktop类型、17语言、插件检查通过，包含原3条桌面主线程阻塞规则。第105轮产品仍未重建2b13262d6、脚本15bbb43e4，系统粘贴的文字/两PNG/URI文件已在原会话可见，切换后返回草稿为空，按预期退出1，失败截图已实际查看；旧bundle hash保留后才重建。[第105轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-chat-draft-baseline/105)。新版真实往返会话、离开文件视图、重开及无自动发送结果待记录；完整草稿清理/附件移除入口和其余聊天功能继续核对，不把当前旧CLI版本拒绝当作真实供应商发送验证。


第106轮固定15bbb43e4736f7c1225421f890de6f20665990bd，重建后实际Linux/Electron/拥有的SSH --chat-clipboard-only --expect-retained-chat-drafts退出0。系统Ctrl+V仍将3474字节中文/emoji/129换行精确放入消息草稿，两PNG独立ID但同hash/像素、41字节URI文件原样存储/下载；另一会话为空，返回原会话恢复原文字和3份附件引用，离开至Files再回聊天仍完整。正常窗口关闭等待私有SQLite保存，重开仍同会话草稿，实际getChatDrafts返回revision=2的一条记录、文字hash及3个opaque ID均匹配；文件权限实际0600、UID1000。远端附件始终3份、没有新上传，服务器journal没有自动user_message或turn，3个原PTY与执行ID/统一worktree cwd保留。六张粘贴、会话隔离、返回及重开截图均已实际查看。[第106轮原始证据](evidence/local-ssh-feature-parity/source-linux-chat-drafts/106)、[阶段三十二红绿/回归/类型/构建日志](evidence/local-ssh-feature-parity/stage32)。当前Codex0.159版本门槛仍真实显示，未升级或绕过、未做真实供应商登录/识图或macOS验收。下一步继续明确草稿丢弃、附件移除、项目/连接生命周期清理及其他原功能；该阶段不代表整个聊天组完成。


### 阶段三十三：原附件卡片、明确草稿丢弃及删除保护

先添加真实缺失入口的失败回归，再复用原AttachmentTile的文件图标、文件名和Remove attachment按钮；只改变当前本地草稿引用，保留原明确下载，不调用远端删除、上传或prompt。原文件卡片增加filename aria-label，旧预览行为不变。Discard changes复用原UnsavedChangesDialog，仅保留Cancel和明确丢弃；可选closeOnDiscard=false使异步持久化完成前不自动关闭，原文件/窗口调用保持默认行为。另一个失败回归确认原AlertDialogAction默认会先关闭、导致丢弃失败错误不可见，已通过可选参数修复。明确丢弃等待私有SQLite确认；失败恢复原文字和引用，显示真实错误、保持原对话框，并暂停写入器自动重试，直到下一次明确动作。原有关于失败保持/300ms防抖及已确认Send清理的语义继续保留。

本地草稿目标匹配采用固定connection/backend/namespace/workspace/session字段，忽略descriptor的generation/能力等附加字段；其他命名空间不误拦截。客户端工作区删除检查包含已存聊天草稿；主进程在真正转发原workspaceCleanup.destroyTrackedV1前再次检查精确作用域，在移除连接前检查该连接全部草稿。移除连接等待原客户端operation内的本地flush，失败保留连接。不更改后端tRPC输入/输出、不自动清除未确认发送日志；用户明确丢弃或手动Send得到成功回复后，空草稿从SQLite快照物理移除。被外部删除或已不可连接目标的完整草稿查看/管理入口仍需继续补齐，不让隐式过期清理代替用户选择。

原附件图标使用实际file页面地址；测试环境about:blank不能解析相对图标URL，造成首轮10失败/2错误，已只修正该测试文件的URL并逐项恢复，未改生产图标解析。丢弃异步测试使用await act等待提交，没有加超时或真实等待。相关11文件65项1303断言，含原4项composer和3条桌面主线程阻塞检查；desktop类型、17语言及插件检查通过。第107轮产品仍未重建15bbb43e4、脚本4e6cee141，原草稿往返/离开视图/重开均保持，通过后因旧UI没有Remove attachment控制而超时退出1；失败截图已实际查看，未执行任何删除工作区尝试。旧bundle hash已保存后才重建，[第107轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-chat-draft-actions-baseline/107)。新版移除/明确丢弃/工作区保护及重开实际窗口待记录，真实供应商和macOS仍须独立验收。


第108轮产品/脚本固定4e6cee141，原附件X移除已持久化、远端原文件下载hash一致；确认删除工作区被草稿保护拦住，但原AlertDialogAction自动触发onClose，真实窗口关闭了对话框，Unsaved changes错误随之不可见，脚本按预期退出1。实际失败截图已查看，工作区目录仍存在，删除未执行。新增回归补上onClose计数及Teardown失败后新草稿的强制删除检查，先4通过/2失败；为原DestroyConfirmPane/TeardownFailedPane增加默认不变的可选closeOnConfirm，并在工作站关闭自动关闭、在原失败面板展示真实阻止原因。相关28项106断言及desktop类型检查通过。一次并行运行generate:icons与测试时manifest恰在重建，出现ENOENT；等待生成完成后重跑通过，不改变产品或超时。[第108轮真实失败](evidence/local-ssh-feature-parity/source-linux-chat-draft-actions-failures/108)。重建dfebaf896后再次验收。


第109轮产品dfebaf896、脚本同revision，原删除对话框留住Unsaved changes且工作区未删除，已返回原聊天确认界面。脚本在Cancel后没有等实际DOM关闭就重新打开，后一个presence检查可能读到尚在关闭的旧对话框，下一次通用按钮点击重新打开而没有确认，空草稿断言失败。两张确认/失败截图已实际查看，原始结果保留为退出1。只修正脚本等待Cancel真正卸载、在原alertdialog内命中明确丢弃，并同时等待空文本与对话框关闭；产品不变，没有增加超时。[第109轮原始失败](evidence/local-ssh-feature-parity/source-linux-chat-draft-actions-failures/109)。


第110轮产品仍dfebaf896、脚本be26db14d，删除保护继续通过；返回会话时脚本在异步选择落盘前读取旧selection，又条件点击了第二个会话，最终会话断言失败，退出1。已实际查看截图，只改为从只读会话清单确定目标可见按钮、物理点击一次并等待原持久化确认，不增加超时。[第110轮原始失败](evidence/local-ssh-feature-parity/source-linux-chat-draft-actions-failures/110)。第111轮产品仍dfebaf896、脚本3828b5cb7，实际Linux/Electron/拥有的SSH退出0：系统粘贴3474字节中文/emoji及两PNG/41字节URI文件、会话/视图往返及第一次重开保持，原附件X移除一份引用后SQLite剩两份，已移除的远端文件仍可下载且hash正确；工作区删除原提示留住Unsaved changes，目录未删。原丢弃提示Cancel保留文本和两份引用，重新打开后明确确认才清空私有SQLite，第二次重开仍空，无新上传或自动prompt/turn，远端三份附件保留。三个原PTY仍PID37533/37545/37539、执行ID与统一worktree cwd一致。五张移除/删除保护/确认/明确清空及重开截图均已实际查看。[第111轮原始证据](evidence/local-ssh-feature-parity/source-linux-chat-draft-actions/111)、[阶段三十三测试及构建日志](evidence/local-ssh-feature-parity/stage33)。离线/已替换后端草稿查看与清理入口继续补齐；不把当前Codex版本拒绝当作真实供应商识图或macOS发行物验收。


### 阶段三十四：离线聊天草稿查看、复制与明确清理

先增加失败回归：原工作台无全局草稿入口、store无离线列表，旧确认可清掉更新后的内容。现复用原Dialog、Textarea、AttachmentTile、聊天CopyButton和UnsavedChangesDialog，侧栏Chat drafts无需任何SSH连接即可打开；移除连接确认页也能进入按连接筛选的草稿列表。所有旧后端/namespace/已不存在会话的本地草稿仍列出，可查看只读文字及附件名称、明确复制原文字或逐条确认丢弃。原附件卡片离线不发起下载；此入口不自动连接、上传、发送、删除远端文件或确认未知操作。仍使用原私有有界SQLite，不增加localStorage、自动过期或静默逐出。

确认同时绑定完整五元作用域及当时文字/附件内容；内容已更新则保留并提示重新查看。明确动作才比较内容，避免每次按键序列化全库。丢弃等待SQLite确认，写入失败恢复文字及引用并保留原确认框，可明确重试。第一次使用对象引用判断时，失败恢复经schema克隆导致第二次确认被误当更改，新回归失败后改为确认时比较有界内容。原Dialog默认non-modal会因嵌套确认的焦点关闭外层，入口回归捕获后仅此管理器采用原modal模式；不改原公共默认。多行文字的首个测试选择器使用默认空白归一化而未命中，已改查询并单独严格断言原换行内容。

本轮9文件64项258断言，加账号启动/主线程阻塞2文件4项1087断言及原composer4项8断言，通过；desktop纯tsc通过，没有与generate:icons并行；四条新文案17种语言已翻译并严格编译，插件检查通过。真实窗口旧构建基线与新版离线复制/断开/重开/清理、重连无自动发送继续验收，尚不能从单测推断真实供应商Agent或macOS行为。


第112轮产品仍未重建dfebaf896、脚本77385872a，先完成原草稿保留/移除引用/工作区保护及本地丢弃提示取消；旧UI没有Chat drafts入口，首次点击按预期超时退出1。失败截图已实际查看，没有执行离线丢弃或重连。旧bundle hash已保存后才重建。[第112轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-offline-chat-drafts-baseline/112)。


第113轮产品/脚本77385872a，实际原Copy按钮将3474字节含中文/emoji/129换行的原文放入系统剪贴板；断开SSH后管理器仍可读，关闭重开保持paused且未自动连接，明确确认在离线时清空SQLite，远端三份附件保持。之后脚本错误地寻找机器页Connect按钮，但恢复后的工作区显示原Reconnect manually/Retry，超时退出1。五张复制/离线/重开/清空及失败截图均已实际查看；只改脚本点击原工作区Retry，并继续同一工作区，不改产品或超时。[第113轮原始失败](evidence/local-ssh-feature-parity/source-linux-offline-chat-drafts-failures/113)。第114轮产品仍77385872a、脚本923a2c465，实际Linux/Electron/拥有的SSH退出0，完整复制/断开/离线重开/取消保留/明确丢弃/原Retry手动重连及最终重开均通过；无草稿复活、额外上传或自动prompt/turn，三份远端文件保持，原三个PTY仍PID41942/41954/41948、执行ID与统一worktree cwd一致。五张管理器及最终重开截图均已实际查看。[第114轮原始证据](evidence/local-ssh-feature-parity/source-linux-offline-chat-drafts/114)、[阶段三十四红绿/类型/语言/构建](evidence/local-ssh-feature-parity/stage34)。旧后端/外部已删会话的恢复以组件及store测试覆盖，本轮没有删除真实远端数据；真实供应商Agent与macOS仍须独立验收。


### 阶段三十五：原终端预设按钮、目标配置与明确启动

先增加失败测试：新终端未传入预设initialCommand，旧后端也会收到预设启动请求；能力转发缺失、当前工作台没有原预设入口。提取原V2PresetBarItem/BuiltinPresetBarItem同一个PresetBarButton，两处旧wrapper继续拥有原拖拽/菜单/快捷键与Tooltip行为；新工作台也使用同一按钮，不拉入云collections或PostHog。原createDefaultV2TerminalPresetRows和getAgentCommandText继续生成默认预设及完整命令，读取所选运行机器的settings.agentConfigs.list，保留参数、环境和权限选项；默认项之外的配置可经Agents菜单明确启动。新终端走原terminal.createSession和稳定operationId，仍在运行机器工作区cwd，保持已有终端；关闭重开不重放启动。旧后端缺能力时只禁用相应入口并解释，普通shell仍可新建；晚目录回复不能填入别的后端。

新增可选workstationTerminalPresetsV1能力，只有支持durableOperations和原恢复的后端声明；主进程只接受字面true。原tRPC过程、输入、输出、错误及传输未改，不改变已发布调用者。53项1282断言/9文件相关回归、桌面类型、17语言及插件检查通过，包含原默认预设/命令生成和账号启动/主线程阻塞。第115轮产品仍未重建77385872a、脚本163f04e06，首个目录查询被旧主进程拒绝Unsupported workstation procedure，退出1，尚未改动夹具配置或启动命令；实际截图已查看、旧bundle hash已保存。[第115轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-terminal-presets-baseline/115)。同一缺口也通过新增主进程失败回归复现，随后仅开放带能力检查的只读列表，其他settings写入继续拒绝；最后39项158断言/4文件通过。一次新测试误认为manager会剥离connectionId/generation，已按原保留归属的合同精确检查，未改转发形状。重建后实际按钮/菜单/命令计数/统一cwd/重开及原3个PTY待记录。自定义脚本预设的编辑、可见性、重排、快捷键和完整Agent设置仍是下一项，不能将本阶段当作整个终端/Agent组已完成。


第116轮产品/脚本固定187f400c9，实际Linux/Electron/拥有的SSH --terminal-presets-only退出0：仅夹具的Codex目录行预置为确定性shell命令后，经原Refresh读取；未点击时计数文件不存在，真实点击预设按钮后一次、打开Agents菜单再选择同项后两次，两条中文/emoji记录和两份cwd均精确匹配统一worktree。两个新shell仍PID45576/45611、执行ID/标题/cwd在关闭重开后保留，计数仍两次，没有自动启动；三个原PTY仍PID45299/45312/45305及原执行ID/cwd。四张原预设按钮/两种明确启动/重开截图均已实际查看。夹具配置属于拥有的测试数据准备，不冒称用户通过尚未接入的配置编辑界面完成，也不将shell探针当作真实供应商Agent任务。[第116轮原始证据](evidence/local-ssh-feature-parity/source-linux-terminal-presets/116)、[阶段三十五红绿/类型/语言/构建](evidence/local-ssh-feature-parity/stage35)。接下来补原Agent配置编辑、命令参数/模式、预设项目范围/隐藏重排及快捷键，仍未完成整个总清单。


### 阶段三十六：原Agent配置字段、版本保存及关闭保护

先复现新配置读取/版本保存缺失，再在原host SQLite配置表上添加getWithRevisionV1/updateWithRevisionV1；读取完整原配置及行指纹，事务内比较后才复用原更新逻辑，过期写入CONFLICT且不覆盖外部修改。原list/add/update/restore/remove等过程形状、输入、错误与传输保持，原35项配置测试和2项新行为共37项89断言通过；host类型检查通过，不新增表或迁移。新增可选workstationAgentSettingsV1，客户端和主进程分别检查能力、明确agent ID及当前generation，只开放新的版本读取/保存；普通旧settings写入仍拒绝。

直接复用原AgentDetailHeader、AgentLaunchFields、SettingsListSidebar、Input及UnsavedChangesDialog，保留Label、完整命令/环境、prompt-only/resume/fork参数和argv/stdin控件与失焦保存。新适配器绑定连接/后端/namespace/generation/agent；旧保存回复不能填进替换连接。失焦保存只在内容确实改变时发起，失败只读核对；若目标已经等于希望保存的字段则确认读回，否则保留原输入，发现新revision提示先Reload，禁止自动覆盖。Reload先原确认，Cancel保留输入，明确确认才读入新版，不写回。离开表单的Save失败会在原确认框显示错误。初次仅按agent ID保留snapshot，连接替换回归失败后改为完整owner匹配；父级pending和选择也按scope隔离。

未保存/待完成设置表单接入原窗口/退出对话框，通过仅包含当前已挂载编辑器的内存登记，不新增localStorage、客户端实体表或设置凭据持久化。关闭时即使文件/聊天干净也受保护；待完成写入禁用继续关闭，明确Save All复用当前版本保存，失败不批准，Cancel保留输入，Don't Save才允许离开。新关闭失败回归先红后绿，文件/聊天原保护回归保持。

同时移除终端目录截取前128项造成的缺项。首个测试错误地只发click没有打开Radix菜单，已改为真实pointerDown合同；在保留旧128截取的源码上再次红，然后移除截取后绿，整个原host配置目录可滚动选择，不新增持久化列表。这里只是临时恢复旧限制来验证回归，不冒称新的真实窗口基线。最终前端/主进程相关11文件79项1440断言、桌面类型、17语言及插件检查通过。第117轮产品仍未重建187f400c9、脚本b8b436f43，原预设仍能读目录/刷新，但没有Agent settings按钮，首次打开编辑页按预期超时退出1；仅有拥有的夹具配置准备，没有通过UI编辑或启动命令。失败截图已实际查看，旧bundle hash保存后才重建。[第117轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-agent-settings-baseline/117)。新版字段/模式保存、外部版本冲突、全局关闭失败、明确Reload及实际运行/重开继续验收；真实供应商Prompt/Resume和macOS仍须独立验证。


第118轮固定b8b436f43，真实renderer在启动阶段空白，About控制未出现而退出1；尚未创建SSH夹具或进行表单交互。失败截图已实际查看。[第118轮启动失败](evidence/local-ssh-feature-parity/source-linux-agent-settings-failures/118)。第119轮产品仍b8b436f43、仅脚本aed5fad3f补充Runtime异常描述及失败console归档，仍退出1，明确定位原AgentIcon→旧theme store→旧electronTRPC客户端在模块加载时创建，当前direct preload不提供该旧global；并非SSH错误。失败截图与异常栈已实际查看。[第119轮诊断](evidence/local-ssh-feature-parity/source-linux-agent-settings-failures/119)。补充的启动依赖回归先定位到同一静态桥接路径，再提取原AgentIconView/AgentDetailHeaderView，原Header wrapper继续用旧store，工作站用本机外观上下文注入，不伪造旧global。原AgentFormControls纯字段直接导入，旧barrel仍保留原Header导出。新增静态桥接依赖断言继续遍历全部静态/导出/动态图，不修改原禁止账号/云bootstrap规则；原终端有条件动态兼容入口保留。首个过宽尝试也保留为失败日志，正式新断言仅禁止静态导入旧settings桥接，没有给特定文件加豁免。相关9项2267断言/3文件与desktop类型通过；重新构建后再验真实启动及完整表单流程，不能将此前79项单测当作启动通过。


第120轮产品/脚本eb6dcaf92，启动恢复并实际打开原设置表单，Label、命令/环境、prompt/resume参数写入检查通过；重新输入与原值相同的fork参数后，界面未显示Saved，脚本在此等待后退出1。失败截图已实际查看，尚未执行后续冲突、关闭保护或运行检查。[第120轮原始失败](evidence/local-ssh-feature-parity/source-linux-agent-settings-failures/120)。新增“输入恢复为原值后不发起写入但确认已保存”回归，先4通过1失败，再5项17断言通过；只修复无变化时的保存反馈和旧错误清除。实际窗口脚本将fork改成不同值`fork --from {sessionId}`，使后续验收包含真实写入；没有放宽等待或断言。相关80项2536断言/11文件及桌面纯类型检查通过，重新构建后再验完整流程。


第121轮产品/脚本764dbeaf2，真实字段/环境、prompt/resume/fork和stdin模式保存通过，未明确启动前无命令执行；外部CAS冲突保留输入，全局窗口关闭Save All显示冲突并阻止关闭，Cancel保留输入。Reload确认取消后保留、明确确认后读回完整外部命令（包括原env/args），但脚本错误地只预期可执行路径，退出1，未达到运行/重开。三张相关截图已实际查看。[第121轮原始证据](evidence/local-ssh-feature-parity/source-linux-agent-settings-failures/121)。只修改脚本使用原getAgentCommandText比较完整命令；第122轮脚本58a19784d因Node/tsx将desktop模块按CommonJS加载，命名导入失败，退出1，未创建SSH夹具或进行设置操作。[第122轮脚本失败](evidence/local-ssh-feature-parity/source-linux-agent-settings-failures/122)。改用模块默认导出后，独立加载检查通过；产品仍固定764dbeaf2，继续实际窗口验收，不延长等待或放宽行为断言。


第123轮产品固定764dbeaf2、脚本a486a67e0，真实Linux/Electron/拥有的SSH `--agent-settings-only`退出0。实际原字段依次保存Label、完整命令/中文emoji环境、prompt/resume/fork参数及stdin模式；未点击启动前计数文件不存在。外部写入改变revision后，失焦保存保留本地Label，远端Label/外部命令不被覆盖；全局窗口关闭Save All显示冲突、不批准关闭，Cancel仍保留输入。原Reload取消保留、明确确认只读入完整外部字段，不改变revision。再次明确保存后，从原预设按钮启动一次，文件精确包含`中文 space 🙂\n`及统一worktree cwd；关闭重开配置/revision一致、计数仍一次，新PTY3553及原三个PTY3253/3265/3259的执行ID/cwd保持。七张相关截图均已实际查看，console错误为空。[第123轮完整原始证据](evidence/local-ssh-feature-parity/source-linux-agent-settings/123)、[阶段三十六红绿/类型/语言/构建](evidence/local-ssh-feature-parity/stage36)。这验证配置与确定性shell探针，不冒称真实供应商Prompt/Resume、macOS或发行DMG通过；Agent新增/删除/重排/恢复默认、图标与自定义预设等继续逐项接入。


### 阶段三十七：原Agent目录管理、新建表单与目标端版本检查

第124轮产品仍固定764dbeaf2、脚本e43af5c1b，真实设置页能打开，但没有原Add agent管理入口，按预期退出1，未新增、删除或运行配置；失败截图已实际查看，旧bundle hash已保存。[第124轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-agent-management-baseline/124)。

先为目录读取、稳定ID新增、过期删除/重置、精确重排和恢复默认添加失败测试，再将原host处理函数提取供新版本操作复用。新增catalogWithRevisionV1/applyCatalogChangeV1：完整行集合指纹在事务内比较后执行，旧调用的形状、默认值、错误和返回保持；旧35项加行版本2项及目录4项共41项104断言通过，不新增表或迁移。新workstationAgentManagementV1与字段编辑能力分开，主进程只为明确支持的后端开放新目录路径，并在异步能力查询后复查generation。

提取原AgentsSettingsSidebarView/AgentSidebarRow、NewCustomAgentDetailView及AgentIconPickerView，旧wrapper仍提供原主题与native文件选择；工作站注入本地外观和本机文件选择，复用原字段、菜单、DND、图标选项与128像素缩图。新建配置只在明确Submit或关闭保护Save时写入，稳定UUID与只读恢复避免丢失回复时重复创建；不自动启动命令。删除/恢复/全量重置采用原确认控件，失败保留确认和错误，不自动重新提交；过期目录需明确刷新和重新确认。新建未提交表单登记到已有内存关闭保护，Cancel保留，明确丢弃才清理；补查发现丢弃后刷新仍保留旧输入，新增回归先5通过1失败，修复表单按epoch重置及关闭登记后6项19断言通过。

相关完整回归先86项2649断言/12文件通过；丢弃修复后相关72项2591断言/9文件通过，侧栏按组件目录拆分后12项2378断言/3文件通过。桌面/host类型检查、17语言严格编译、插件及lint检查通过。两个新确认文案已补齐全部语言。正在构建并验实际新建、原拖拽、删除/恢复默认、过期重置和重开，不以组件测试替代真实窗口；配置图标后续编辑、自定义脚本预设/项目范围/隐藏/快捷键等仍待继续接入。


第125轮产品/脚本54254eb44，原新建表单、未提交关闭窗口/Cancel、内置图标选择及目标端完整配置新增通过，明确启动前计数文件不存在；随后打开原Agents启动菜单，新项位于原滚动列表底部，脚本未滚动即尝试可见点击，超时退出1。三张相关截图已实际查看，尚未启动命令、排序、删除、恢复或重置。[第125轮原始失败](evidence/local-ssh-feature-parity/source-linux-agent-management-failures/125)。只修脚本使用真实滚轮滚动原菜单，保留全部目录项、实际布局、产品和等待条件；产品仍固定54254eb44继续验收。


第126轮产品54254eb44、脚本e24308f23，菜单滚动辅助错误增加8像素内边距，但原菜单实际4像素padding，已可见的首项被错误判成裁切，退出1，未写配置；失败截图已查看。[第126轮脚本失败](evidence/local-ssh-feature-parity/source-linux-agent-management-failures/126)。改按真实菜单与视口边界判断后，第127轮产品仍54254eb44、脚本6c816b61e通过原表单/图标、新建后明确执行一次、原手柄相邻拖拽（含往返及停留）、恢复默认且ID/order保持、取消删除及确认删除且PTY仍活；之后原Add菜单底部Reset入口滚不到，退出1，未执行重置和最终重开。三张拖拽/删除/失败截图已实际查看。[第127轮证据](evidence/local-ssh-feature-parity/source-linux-agent-management-failures/127)。

第128轮产品仍54254eb44，脚本14de7f61b只增加滚动几何记录并将滚轮坐标限制在可见弹层交集，重置入口仍不可达，退出1；记录明确显示hitMenu=true、scrollHeight794/clientHeight681，但菜单scrollTop始终0、外层Dialog却滚动103像素。原DropdownMenu默认modal=false，嵌入当前modal设置Dialog时其portal不在外层滚动锁范围。失败截图已实际查看。[第128轮诊断](evidence/local-ssh-feature-parity/source-linux-agent-management-failures/128)。为原侧栏和图标选择展示组件增加可选menuModal，旧wrapper默认仍false；只有工作站模态设置传true，复用原Radix菜单已有模态/滚动范围，不加手写滚轮搬运。相关12项2378断言及lint通过，重建后用相同真实滚动和几何检查继续验收。


第129轮产品f43d544f3、脚本同版本，实际菜单滚动已生效：同样滚轮下菜单scrollTop216、外层Dialog保持0，Reset入口可见可点击。新建/启动/原排序/恢复默认/删除，以及外部写入后过期重置保留确认和数据、Cancel后明确Refresh并重新确认重置均通过。最后关闭重开后，脚本立即查询尚未恢复的descriptor，在正常Reconnecting界面退出1，尚未完成最终读回；三张过期重置/新确认重置/失败截图已实际查看。[第129轮原始证据](evidence/local-ssh-feature-parity/source-linux-agent-management-failures/129)。只修改脚本先等待相同connection/backend/namespace的已认证描述及可用原预设目录，再做最终只读核对；产品保持f43d544f3。


第130轮产品固定f43d544f3、脚本9e2f10a04，真实Linux/Electron/拥有的SSH `--agent-management-only`退出0。原新建表单/关闭Cancel/内置图标选择新增自定义配置，显式启动后中文emoji计数一次且cwd精确为统一worktree；原Add菜单新增Pi，原手柄相邻重排（含往返及停留）持久化，原恢复默认保留ID/order。删除取消不写入，确认删除仅移除配置，已启动终端保持。全量重置确认期间外部更新导致CAS拒绝且原确认/数据保留，Cancel后原Refresh重新审阅、再次明确确认才重置；菜单滚动trace证明独立滚动范围生效。关闭重开后目录/revision完整一致、计数仍一次、没有自动重跑；新PTY10966和原三个PTY10689/10701/10695的执行ID/cwd均保持。九张相关截图均已实际查看，console错误为空。[第130轮完整原始证据](evidence/local-ssh-feature-parity/source-linux-agent-management/130)、[阶段三十七红绿/类型/语言/构建](evidence/local-ssh-feature-parity/stage37)。图标原生文件选择、已有配置图标编辑、空参数/空目录持久化、自定义脚本预设、快捷键、真实供应商Agent和macOS仍继续逐项验收，不将当前确定性shell探针等同完整功能清单完成。


### 阶段三十八：显式清空参数和空Agent目录

新增失败测试先复现缺少保留明确选择的新接口（旧41项仍通过、新2项失败）。原V1/list语义包含空表自动播种和内置fork空参数补全，不能用这些读取路径来保留用户清空选择。为运行机器私有SQLite的host_settings增加agent_catalog_initialized布尔标记，使用host-service的Drizzle生成0038迁移，迁移与接口实现分开提交；没有修改packages/db云端迁移。仅增加单行设置的非空false默认列，没有类型转换或数据重写。拥有的内存SQLite从0037迁到0038并再次迁移回放，原worktree/branch-prefix/vendor-profile字段保持，初始化标记默认false且设true后重复迁移保持；原始脚本与日志保留。

新增可选workstationAgentCatalogV2以及catalogWithRevisionV2/applyCatalogChangeV2：在事务内仅首次初始化播种，之后读取不补回用户清空的fork，也不复活被明确删空的目录；显式Reset仍复用原默认值处理。目录集合CAS和稳定ID新增复用同一原处理器。旧list/V1输入、返回、播种和补全语义保持，旧客户端行为不改变。客户端与主进程分别检查V2能力，异步查询后重新验证generation；新工作站预设栏/管理页优先V2，旧后端继续原已支持路径。原AgentSettingsEmptyState提取复用，空目录显示原提示和Add菜单，设置按钮仍可打开，不停在Loading或禁用管理。

前端/主进程相关75项2614断言/9文件、host原设置及新选择44项110断言、额外主进程读/写能力门控32项113断言通过；桌面/host类型、17语言严格编译、插件和lint通过。新保留原机器字段测试最初未收窄可空查询结果导致类型失败，补充明确存在检查后通过，没有修改运行时数据合同。

第131轮产品仍固定f43d544f3、脚本2c6363a6c，真实原Fork字段清空、失焦后显示Saved，但该产品使用的V1目录读取重新补回Claude默认`--resume {sessionId} --fork-session`；只读get与明确选择不一致，断言按预期退出1。失败截图已实际查看，UI输入与实际行的读回JSON均保留；尚未进入目录逐项删除或重开空目录。[第131轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-agent-catalog-choices-baseline/131)。新版本正在构建，再用原控件逐项删除全部默认配置并验空目录重开、原Add只恢复所选一项和已有PTY保持。


第132轮产品固定8242be6aa、脚本e6682f193，真实Linux/Electron/拥有的SSH `--agent-catalog-choices-only`退出0：原Fork字段清空、Saved后V2目录/行读回为空，关闭重开仍为空；通过原Delete agent/确认逐项移除全部22个已审阅默认ID，每步计数精确减一，原空状态出现。再次关闭重开后目录仍为空/revision一致，无默认项复活，设置仍可打开。经原Add菜单只新增Pi，关闭重开仅此一项/revision保持；没有启动Agent或新增PTY，原三个PTY13615/13627/13621的执行ID/cwd均保持。五张相关截图均已实际查看。[第132轮完整证据](evidence/local-ssh-feature-parity/source-linux-agent-catalog-choices/132)、[阶段三十八迁移回放/红绿/类型/语言/构建](evidence/local-ssh-feature-parity/stage38)。共享真实输入/原菜单滚动驱动从前一验收提取复用；清空通过真实Backspace，删除循环限定原审阅ID且验证每步减一，不用无限循环掩盖重播种。新V2客户端保留明确选择，旧list/V1的兼容语义仍保留；原CLI本地目标接入与新读取适配继续列在待办。真实供应商Agent、macOS和原生图标文件选择仍未由此验证。


### 阶段三十九：已有Agent图标编辑与客户端系统选图

先为已有配置缺少原图标选择器添加2项失败回归，旧5项仍通过。复用WorkstationAgentIconPicker/原AgentIconPickerView，图标字段纳入现有行版本patch和完整读回匹配；明确选择即使用原版本保存，不改命令/权限/env/prompt字段。失败读回不能因其他字段相等就误确认一个未存储的图标；输入和关闭保护仍保留。补查原打开菜单在disabled变true后仍可选项，新增回归实际触发Gemini选择而失败，再把原菜单Upload/No icon/内置项一并按disabled或isProcessing禁用，旧wrapper的disabled语义也得到贯彻。原预设栏本来已使用agent.iconId，直接复用现有回显。相关45项2502断言/8文件、桌面类型、17语言严格编译、插件及lint通过，不新增后端接口或迁移。

第133轮产品仍8242be6aa、脚本89ced6c5f，已有编辑页只有Label/Launch，没有Icon选择器，原控件可用性检查按预期超时退出1；失败截图已实际查看，旧bundle hash保存后才重建。没有图标写入、文件选择框或命令执行。[第133轮旧构建基线](evidence/local-ssh-feature-parity/source-linux-agent-icons-baseline/133)。第134轮产品112b9fa1f、脚本445e9c197，内置图标保存及原预设栏回显、真正拥有的GTK文件选择框打开/取消、取消后行与revision精确保持均通过。上传时中文/emoji路径已输入，但Return未激活Open，文件框仍在而退出1；四张相关回显/取消/系统文件框截图已查看，尚未存储PNG或验后续冲突/重开。[第134轮原始失败](evidence/local-ssh-feature-parity/source-linux-agent-icons-failures/134)。只改验收输入：明确记录系统位置框，再对同一拥有的Open File窗口使用Open助记键；每次以PID和transient parent校验归属，不向其他窗口发送输入，产品保持不变。

第135轮产品固定112b9fa1f、脚本6ce1ff596，真实Linux/Electron/拥有的SSH `--agent-icons-only`退出0：原内置Gemini选择更新已有Claude行且其他启动字段完全保持，原预设栏立即回显；真实GTK取消无写入。通过系统位置框/原Open动作选择客户端带空格、中文、emoji文件名的1024 PNG，原缩图后128×128，返回SSH配置的PNG字节SHA及header/原预设栏src一致，关闭重开行/revision/图标保持。外部更新命令后换图标触发CAS冲突，保留本地Codex选择、不覆盖服务器PNG或外部命令；Reload取消保留，确认只读恢复，原No icon重置后重开恢复默认标记，外部命令保持。全程未启动Agent，原三个PTY18055/18067/18061的执行ID/cwd不变；十二张相关截图（含真实系统窗口）均已实际查看。[第135轮完整证据](evidence/local-ssh-feature-parity/source-linux-agent-icons/135)、[阶段三十九红绿/类型/语言/构建](evidence/local-ssh-feature-parity/stage39)。这是PNG与取消/冲突/重开路径，其他格式/损坏/超限边界、真实供应商任务及macOS仍须独立验收。


### 阶段四十：原终端脚本管理接入机器 SQLite

复用原PresetEditorDialog、PresetsTable、PresetRow、CommandsEditor和ProjectTargetingField的视图，保留原V1/V2 wrapper及旧数据源；原目录浏览组件从ProjectDialog提取后同时复用。Workstation使用自己的主题、所选主机项目和filesystem.browseHost，选择远端文件夹后沿用原workspace-relative转换，避免客户端目录误入SSH配置。此阶段接通管理和持久化；原脚本栏实际启动、四模式执行、自动触发、workspace Run映射、快捷键和CLI脚本命令尚待接入，界面启动标记的保存不等于触发行为已经完成。

私有host.db由Drizzle生成独立迁移0039（单独提交6444039c5），新增有界terminal_preset_catalog单行目录，不涉及云数据库、organization或Superset账号。新catalogWithRevisionV1只读；明确initialize变更使用原默认预设生成器的行、稳定UUID和CAS初始化一次，空目录不会自动播种。新增applyCatalogChangeV1支持新增/修改/删除/完整重排，事务内校验目录版本；单调计数参与SHA版本，恢复相同字段也不能接受ABA旧写入。目录最多512项、每项128命令、总JSON最多4MiB；初始化/顺序/ID/长度验证失败保持原目录。可选workstationTerminalScriptsV1严格为true才调用新接口，主进程独立检查能力及连接generation；旧接口未改。

先保留缺模块基线，再以无操作实现取得8项实际行为失败；补实现后8项32断言通过，覆盖原字段/日期持久化、只读初始化状态、过期写入、删空、重复ID、原子重排、清空可选字段、ABA和无效输入。主进程新门禁先因Unsupported workstation procedure失败，再通过严格布尔/旧主机/过期generation测试。客户端无界面基线1通过4失败后，接原表单和关闭注册表；原生输入外另以组件验证修改、保存回复丢失后的只读确认、冲突草稿/Save All/重复blur拒写、只初始化一次、旧主机不调用。首次目录读取失败导致入口无法重试、缺目录仍可Add两项问题均先失败再修复。新建稳定ID、最后命令清空、删除取消/确认、远端目录及脏编辑器Cancel/Save & Continue等回归通过。最终后端/主进程/迁移89项278断言/4文件，客户端及启动图审计26项2595断言/6文件，相关Agent/原启动17项61断言/3文件通过；桌面与host类型、17语言严格编译、插件检查和完整CLI/5个PTY marker构建通过。Lint无错误，有一项经过完整成员校验后的Map非空断言提示。[阶段四十红绿及构建记录](evidence/local-ssh-feature-parity/stage40)。

第136轮仍运行112b9fa1f旧构建，真实Linux/Electron/拥有的SSH界面缺少Terminal Scripts管理入口，按预期退出1；入口截图已实际查看，旧bundle hash在重建前保存。该入口基线脚本当时未提交，原始失败记录保留，不给它补造提交版本。[第136轮基线](evidence/local-ssh-feature-parity/source-linux-terminal-script-management-baseline/136)。第137轮产品9c294109a、脚本42b27d4d9，原列表/中文emoji名称/描述/双命令保存已通过；原启动模式菜单实际打开，但脚本取了不存在的item.id而超时退出1，列表和失败截图已看。只改定位为原可见选项及其真实兄弟序号，产品未改。[第137轮失败](evidence/local-ssh-feature-parity/source-linux-terminal-script-management-failures/137)。第138轮脚本34e40959e，模式、项目范围、远端选目录、启动标记、隐藏保存通过，CDP拖动未使顺序改变而退出1；四张相关截图已看。[第138轮失败](evidence/local-ssh-feature-parity/source-linux-terminal-script-management-failures/138)。第139轮脚本85954f46e记录逐步几何/DOM/SQLite顺序及浏览器原生事件：手柄draggable为true，但全部CDP鼠标移动及释放都没有dragstart/dragover/drop；顺序不变并退出1，失败截图已看。此结果只定位验收输入不足，未据此修改原排序产品逻辑。[第139轮原始记录](evidence/local-ssh-feature-parity/source-linux-terminal-script-management-failures/139)。

第140轮产品固定9c294109a、脚本419f00584，真实Linux/Electron/拥有的SSH `--terminal-script-management-only`退出0。新增脚本稳定ID，原名称/描述/双命令/项目范围/目录`.`/新标签分屏模式/三个启动标记/隐藏选择均存到所选SSH目录。对同一拥有窗口验证PID、窗口归属、内容边界和scale后使用XTest系统鼠标拖动；原HTML5 dragstart/dragover/drop/dragend实际产生，反向小幅移动与500ms停留后顺序在SQLite读回正确。关闭重开目录/revision/字段保持；外部目录版本变化后名称修改拒写且本地草稿保留，Reload取消保留、确认只读恢复；删除先取消再确认，然后通过原确认逐项移除8个已审阅默认脚本，重开仍为空且管理/Add可用。原三个PTY8605/8618/8612、执行ID及统一worktree cwd保持，没有启动任何脚本或Agent；十张相关截图均已实际查看。CDP按值返回Date在原始诊断JSON中表现为`{}`，此轮不独立证明时间戳；日期持久化由host的类型化路由测试验证。[第140轮完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-script-management/140)。这仍是管理验收；真实macOS、供应商执行和后续启动接入不由它推断。

后续启动接入的前置缺口已明确：当前恢复模型每个workspace只有一个pane layout，并禁止重复workspace标签，不能直接表达原版同一workspace内的多个终端标签页。需先保留并恢复原终端标签页语义，再复用getPresetLaunchPlan/resolvePresetLaunchCommands；sequential向已有PTY写入还需持久操作确认，不能通过重试直接send重跑命令。管理里保存的scope/模式/隐藏/触发标记及快捷键/CLI接入继续留待办，不把当前默认Agent按钮当作完整脚本功能。

## 阶段四十二：终端触控板滚动与 TUI 客户端历史查看

用户新增要求：本地和 SSH 终端、coding agent TUI 内，上下滑动应查看内容，不能把滚动误作方向键字符。沿用原 shared wheel handler、cell dimensions、像素余量累计及 SGR 鼠标编码；发现原无鼠标模式的 alternate buffer 明确发送方向键，stock xterm 同样回退发送方向键。先更新行为测试，得到20通过6失败，再移除这条输入路径；普通 normal buffer 保留原 viewport 滚动，支持鼠标的 TUI 保留正确原生滚轮报告，Shift 可绕过应用鼠标捕获。新客户端历史查看接入 createTerminalSurface 和原 terminal-runtime，因此本地/SSH 与原终端运行时共用；键盘方向键不受此修改影响。

无鼠标模式的 alternate buffer 没有 xterm 原生 scrollback，新历史查看保留已显示文本：每100ms至多采集一次当前屏幕，重复画面跳过、实际行滚动按后缀/前缀重叠合并，完整重绘以空行分隔；每实例最多10000行、1MiB历史与1MiB上一屏，不落 localStorage 或磁盘。向上滑动打开可选择复制的只读文本查看，包含已有 normal buffer 历史与已采集 TUI 屏幕；向下到底、Esc、End 或关闭按钮返回实时终端。查看期间粘贴/拖入不会误发到后端；尺寸改变关闭查看；退出 alternate buffer、清屏历史、终端 reset 清空历史；dispose 释放查看、历史、监听器和定时器。它是有界、采样的已显示文本记录，不是 TUI 内部完整会话或图像/颜色重放；不能恢复客户端附着前已经丢弃的画面。应用支持鼠标时继续让应用自己滚动其完整历史。

历史无操作基线2项实际失败后补实现通过；最终shared wheel 26项/53断言，客户端历史及真实 headless VT 模式解析5项/26断言通过。真实 VT 测试覆盖 DEC1049/DECCKM/1000/1006 切换、SGR 上下滚动、Shift 查看以及回到 normal buffer；不以 mock 的 mode 值代替协议测试。相关本地输入/图片粘贴/RemoteTerminal/运行时回归62项/213断言通过；桌面与shared类型、插件检查、17语言检查及严格编译、含 CLI 与5个PTY marker的完整构建通过；新代码 lint 最终无错误。中间 lint 的 restricted global 名称错误修在测试中，原始失败日志保留。[阶段四十二红绿与检查](evidence/local-ssh-feature-parity/stage42)。

真实 Linux/Electron 与拥有的 loopback SSH：第142轮多行夹具命令被终端合并、第143轮文件 API 返回 bytes 而脚本未解码，两轮均退出1；失败截图已查看，仅修验收脚本，未调整产品或放宽断言。第144轮产品9c294109a、脚本4709b71b4成功运行同一 raw-mode TUI 夹具，向上滚动实际向远端发送六次 ESC[A，输入字节断言退出1；普通终端滚动前后及 TUI 失败截图已查看。[142–144原始失败](evidence/local-ssh-feature-parity/source-linux-terminal-wheel-failures)。

第145轮产品491b19174、脚本fe0ccd54f，真实桌面 `--wheel-only`退出0：普通终端滚动无输入，TUI 完整重绘后向上查看可见前一屏与 shell 历史；只读查看scrollTop3431、scrollHeight4016、clientHeight489，与截图一致。反向/小幅/大幅滚动后远端输入保持只有明确键入的a/n，Esc返回亦不发送Escape；继续输入s后启用原生SGR，上下滚动收到正确64/65报告而无方向键，输入q正常结束。五张滚动截图均已实际查看，浏览器错误数组为空。[145完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-wheel/145)。这是源码桌面和SSH协议夹具验收；尚未独立执行本地连接原生窗口、真实供应商Agent或macOS触控板/安装包验收，不能由夹具结果推断这些测试已经完成。此前阶段四十一的原终端标签页工作暂存后独立构建此修复，未作为本轮产品内容发布。

## 阶段四十一完成记录：复用原终端标签页与每标签布局

本阶段先开始，中途按用户新增要求优先独立完成阶段四十二滚动修复，再恢复暂存工作。原WorkspaceWindow每个workspace只有一个平铺layout，无法表达脚本的new-tab/new-tab-split-pane模式。恢复模型增加可选paneTabs/activePaneTabId，每组保存原布局树、稳定标签ID、名称、创建时间和焦点，原panes资源列表继续用于恢复核验。主进程严格验证组成员对panes恰好完整分区、无重复/未知引用、全局与活动组焦点一致、64组/64pane、树深度和原总量上限；无效写入不覆盖已有记录，明确空组保持空。未增加云端数据源或迁移旧预览数据。

promote原pane-adapter后，本地元数据与原@superset/panes store共用；直接渲染原Workspace、TabBar、改名、关闭、HTML5拖动和原WorkspaceTab。原紧凑窗口布局保留，按当前终端标签的实际可用空间判断；未显示组不误附着另一组终端。New terminal明确新建终端标签，Split留在所选标签；原store移动/排序/聚焦/名称/布局变化写入本机SQLite视图，不发新终端RPC。原Workspace新增两个可选显示/拖入过滤参数，旧调用保持默认行为；阻止跨workspace/机器拖入外部资源。每次创建的ID/时间在元数据乐观写入与CAS重试回调外生成，创建命令仍由现有持久操作仅发送一次。保存以运行资源/执行ID为界，晚回复不能覆写新执行，过期同字段修改拒绝；不同字段的名称、焦点和resize按原值检查后合并，保留新焦点/新标题/新布局。乐观标题在异步保存期间保留，不被独立终端focus写回旧值。

TDD包括视图SQLite持久化、非法分组原子拒写、原store标签分离/改名/关闭、执行边界、延迟resize绑定原组，以及New terminal真实按钮参数。最初按钮用文字定位与空状态重名，保留该脚本失败；改为工具栏真实按钮后取得旧行为失败，再接新标签参数通过。第146轮发现并发元数据拒写与焦点丢失，补延迟改名/焦点重叠行为测试6通过1失败，再补逐字段合并和乐观写回通过；暂停实际save的hook测试证明输入标题在排队focus期间保持。最终桌面33项145断言/7文件、原panes包121项260断言/5文件通过；桌面与panes类型通过，完整构建CLI/5个PTY marker通过。lint无错误，既有及新增测试有非空断言提示，原始输出保留。[阶段四十一检查](evidence/local-ssh-feature-parity/stage41)。

第141轮产品9c294109a/脚本c3078f649：原窗口New terminal仍加入同一平铺布局，独立标签断言退出1，失败截图已查看。[141基线](evidence/local-ssh-feature-parity/source-linux-terminal-pane-tabs-failures/141)。第146轮产品200e31e37/脚本3e7adece1：新模型已进入公共恢复夹具，但连续改名/focus出现保存错误和输入失焦；同时公共拖动检查仍观察已经改为兼容投影的旧全局layout，而不是屏幕显示组layout，最终退出1。失败截图已查看。产品补元数据合并/乐观标题，脚本只把布局观测改到活动终端组，原拖动/0.37比例/PTY断言保留。[146原始失败](evidence/local-ssh-feature-parity/source-linux-terminal-pane-tabs-failures/146)。

第147轮产品bae7e375f/脚本e9b1c1912退出0，实际新建标签/组内分屏、中文改名、原生拖动顺序、SQLite重开和后端PID保持通过，七张相关截图已查看；但重开/关闭两图仍在Reconnecting/Session status unavailable阶段，故这一轮不接受为终端重新附着的证据。保留原始退出0，不改造失败结论；增强脚本要求重开组两个终端、关闭后原组三个终端均实际attached，并校验全部五个PID后再截图。[147观测不足记录](evidence/local-ssh-feature-parity/source-linux-terminal-pane-tabs-failures/147)。

第148轮同产品bae7e375f/脚本f171ced24，实际Linux/Electron/拥有的SSH `--pane-tabs-only`退出0。真实New terminal创建独立原标签且保留原组三pane布局；Split vertically只向选中组增加一pane；原标签双击输入SSH tools 中文保存，验证窗口归属/PID/scale的XTest鼠标完成原HTML5标签拖动排序；关闭重开标签顺序、名称、活动组、组内布局、五个PTY19764/19770/19776/20028/20038及执行ID保持，两个恢复终端实际附着。关闭新组后原三个终端实际附着且继续输出原心跳。全部七张相关截图已实际查看，浏览器错误为空。[148完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-pane-tabs/148)。这不等于真实macOS、供应商Agent、所有跨标签合并/分离/固定功能或自定义脚本执行已验收；关闭标签仅沿用已有视图移除语义，不以此证明后端进程终止。脚本目录管理虽已完成，原条目按钮/快捷键/触发与完整启动计划/CLI仍继续接入。

### 阶段四十二补充：只读历史的真实选区、复制与图片粘贴

联检发现初版只拦截查看层自身的bubble事件，原终端图片粘贴使用父层capture，仍可能先上传附件；原xterm鼠标选择/旧选区的copy处理也可能覆盖历史文字选择。因此不能把初版查看层的事件单测当作完整剪贴板边界证明。补实际DOM父层capture集成与copy传播测试，2通过2失败；在父层图片粘贴入口先检查只读历史目标并拒绝，历史层隔离mousedown/mousemove/mouseup/copy/contextmenu，同时保留浏览器的默认文字选择/复制。退出历史后原终端处理继续使用。相关历史/真实VT/原图片粘贴27项69断言通过；终端/输入/RemoteTerminal/复制回归91项247断言/10文件、桌面类型、lint及完整CLI/5个PTY marker构建通过。[补充红绿与检查](evidence/local-ssh-feature-parity/stage42-clipboard)。

第149轮产品bae7e375f/脚本310786752，真实鼠标在可见FIRST SCREEN 中文位置拖选，实际浏览器选区却是底层TUI line 011，断言退出1，失败截图已查看；尚未到达图片粘贴步骤，不把它记成原生图片上传失败证明。[149原始失败](evidence/local-ssh-feature-parity/source-linux-terminal-wheel-clipboard-failures/149)。第150轮产品ce2173fce/同一验收逻辑，真实桌面 `--wheel-only --wheel-clipboard`退出0：相同坐标的鼠标拖选得到FIRST SCREEN 中文，系统剪贴板精确读回该文字；再从真实系统剪贴板粘贴PNG，document实际收到位于历史层且包含1个File的paste，远端attachments前后为空、输入仍只有明确键入的a/n。随后反向/小幅滚动、Esc返回、原生SGR上下滚轮和q结束全部通过，浏览器错误为空。只读历史复制/图片粘贴截图已实际查看，其余截图本轮捕获；此前第145轮相关滚动截图已查看。[150完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-wheel-clipboard/150)。真实macOS触控板/系统剪贴板、独立本地连接窗口和供应商Agent仍是单独验收项；本轮不生成或宣称1.37.7 DMG。

## 阶段四十三：原自定义终端脚本的手动启动与关闭等待

脚本栏接所选后端已保存的原目录，复用原项目筛选、图标和PresetBarButton；项目专属优先、条目顺序、隐藏和明确空目录保持。管理器保存成功直接更新脚本栏，旧目标晚回复不能覆盖当前目录。新增独立可选workstationTerminalScriptExecutionV1；只有管理能力的旧后端可以管理但不能启动，不退回未经确认的命令写入。第三方Agent菜单与设置继续保留。

启动复用getPresetLaunchPlan、resolvePresetLaunchCommands、原命令构造、原pane store和统一worktree路径。new-tab每条命令一个原标签；new-tab-split-pane在一个新标签分屏；split-pane向启动时选中的原组增加pane；sequential向捕获的现有执行提交组合命令，无可用终端时按原计划创建终端。中文/空格相对目录通过引用后的绝对cd执行，不依赖当前shell临时目录。创建请求顺序提交以遵守已有单个待确认操作约束，已启动进程可并行运行；目标切换停止尚未提交的命令，部分失败保留已确认终端，丢失回复不重试。

现有终端增加terminal.runScriptV1持久操作，经所选workspace归属/执行ID检查、已有daemon连接、写前再次检查、每个frame绑定原执行、写后确认；复用原framing、队列、Agent绑定和输入处理。已有操作账本在副作用前记录接受，完成结果可读回；中断或失去确认保持未决，不自动重放。确认表示输入已提交，不表示shell命令完成。输入预算与原4MiB脚本目录及命令包装开销一致，合法300KiB命令的失败测试先红再绿。原程序/路由合同保持，不新增数据库迁移。

TDD包括原目录栏、空目录/项目范围/隐藏、独立严格能力、四种启动计划、已有执行绑定、重复/失去确认保护、目标切换、部分创建和窗口关闭。原无操作hook/交付基线均实际失败后补实现。最终客户端67项314断言/5文件、后端17项41断言/4文件通过；desktop/host类型、renderer-safety、后端导入隔离、插件检查、17语言严格检查及完整CLI/5个PTY marker构建通过。普通Node运行原PTY回归因Electron native addon ABI不同退出1，原始日志保留；没有重编全局addon，改用实际随应用分发的Electron Node运行同一套38项真实PTY测试通过。最初HappyDOM失败对象输出约230MiB，原始文件保留在执行环境，仓库保存无损xz与原大小/SHA256，不删除失败或截断替换。[阶段四十三检查与红绿](evidence/local-ssh-feature-parity/stage43)。

第151轮产品ce2173fce/脚本5b55e1ee1，真实Linux/Electron/拥有的loopback SSH通过原编辑器保存自定义脚本后，栏中缺少启动入口，退出1；保存后截图已查看。[151原始失败](evidence/local-ssh-feature-parity/source-linux-terminal-script-execution-failures/151)。第152轮产品2a36063d7，四种模式依次实际点击，pane/标签总数为6/4、8/5、10/5、10/5；每条命令只写入一次模式标记且pwd为统一worktree下的中文空格目录。sequential前在原终端明确cd /tmp，仍按脚本目录执行；关闭重开标记不增加、10个执行/PID保持，六张相关截图均已实际查看，浏览器错误为空。[152四模式与重开](evidence/local-ssh-feature-parity/source-linux-terminal-script-execution/152)。

第153轮同产品、脚本f80fcbf49，通过PID/UID/fixture路径/命令行严格核验后暂挂拥有的测试backend，在实际点击启动请求仍忙时正常关闭窗口。200ms后窗口已关闭，busy=true/alive=false，断言退出1；finally恢复backend，没有强杀或放宽断言。关闭前原模式重开截图已查看，失败后窗口不存在，没有伪造关闭中截图。[153实际关闭失败](evidence/local-ssh-feature-parity/source-linux-terminal-script-execution-failures/153)。先补flush行为失败测试，再让正常关闭等待终端启动和元数据保存。第154轮产品93554c545，同一场景busy=true/alive=true，释放backend后关闭重开恢复12个pane，窗口关闭脚本A/B只各增加一行；退出0，恢复后附着截图已查看；暂停期间窗口存活由held JSON记录。[154脚本关闭等待](evidence/local-ssh-feature-parity/source-linux-terminal-script-execution/154)。

进一步将普通New terminal也纳入同一等待流程，先增加实际失败测试再修复。第155轮产品/脚本9a69fd434，四模式、重开、脚本批次关闭中和普通终端创建中正常关闭全部退出0。拥有backend31638暂挂期间两次窗口均保持busy且存活；恢复后最终13个pane/8个原标签、13个执行都存活，之前10个PID和执行ID不变，A/B各五行且普通创建/重开没有重放脚本；浏览器错误为空。脚本及普通终端关闭等待两张截图已实际查看，其余六张本轮捕获；四模式截图已在152轮查看。[155最终完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-script-execution/155)。强制杀死客户端不承诺提交尚未发送的命令。

本阶段仍不等于全部终端脚本对齐：applyOnNewTab/applyOnWorkspaceCreated/useAsWorkspaceRun、关联Agent编辑选项、原栏上下文菜单/拖动显隐/快捷键/CLI仍待接入。另确认当前Workstation的视图管理明确排除了local连接，本地仍用旧WorkspaceEditor；共享backend和终端surface测试不证明原WorkspaceWindow这些新功能已在本地界面可用，后续必须补齐本地入口和namespace恢复隔离。真实macOS/供应商Agent、独立本地连接原生窗口和1.37.7 DMG均未由本轮验证。

### 阶段四十二补充：独立本地设备入口的实际窗口滚动验收

第156轮产品9a69fd434/脚本c1cd245ba，独立新profile，不创建SSH夹具；通过实际Local Device → Workspaces → New session → Terminal → New terminal进入当前本地WorkspaceEditor。由只读refreshFeatures取得实际连接描述，不重连或修改连接状态；真实本地session路径位于拥有的新profile namespace之内。复用相同raw-mode TUI和真实鼠标滚轮/系统剪贴板验收，退出0。普通normal buffer第一可见行从SHELL HISTORY 182滚到179，输入为空；alternate buffer重绘后可见FIRST/SECOND SCREEN，历史scrollTop3668/scrollHeight4096/clientHeight332。向上、反向/小幅/大幅滚动不增输入；实际鼠标选择/系统复制FIRST SCREEN 中文精确一致，真实系统PNG paste含1个File、目标为查看层，attachments前后均为空且输入仍只有a/n。Esc返回不向TUI发送Escape，原生SGR上下64/65报告保持且无方向键，q结束正常，浏览器错误为空。普通滚动前/后、TUI历史、历史复制粘贴、原生鼠标五张截图均已实际查看；其余截图捕获，未混称全部查看。测试结束通过已有LocalNamespaceBackend.stop停止拥有的新profile backend，未留下config156进程。[156本地完整证据](evidence/local-ssh-feature-parity/source-linux-local-terminal-wheel/156)。

这补齐了共享滚动修复在独立本地窗口的实际验证，不改变阶段四十三指出的本地完整WorkspaceWindow入口缺口；真实macOS触控板/供应商Agent和1.37.7安装包仍未验收。普通终端滚动、无鼠标TUI客户端查看、支持鼠标TUI的原生滚动分别保留，客户端查看只记录有界已显示文本。

## 阶段四十五：本地接入原工作区窗口与 namespace 视图隔离

阶段四十三确认本地仍使用旧WorkspaceEditor。本阶段移除本地的显式排除：有workspaceViewRestoreV1时，本地和SSH都进入已有WorkspaceWindow、原@superset/panes标签/分屏/原预设栏；无能力的旧后端继续已有入口。没有复制一套本地布局或模拟Superset账号。组件测试先固定旧本地入口不出现原窗口的失败，再补接入；真实第158轮也在同一点击路径复现旧界面和断言失败，截图已查看。

本机workspace-views.db新增内部local_namespace_views表，保存离开namespace时的已验证视图；选择时以connection/backend/namespace/UID隔离，将选中namespace视图换回活动快照，SSH目标保留。归档与活动视图替换在同一FULL同步SQLite事务完成，版本递增拒绝旧排队写入；归档仍按原2MiB视图、20工作区及全局pane/树深度约束验证，最多64个归档，不静默驱逐。主进程只接受与当前可信本地身份一致的写入，不能把旧namespace内容重新签为新目标；切换时清除连接授权，返回原namespace仍须明确连接。namespace持久化失败时回滚原选择与可信pin；Forget清除活动及所有归档视图，移除已停止的非当前namespace后也清理其布局元数据，数据文件沿用原保留语义。未修改host/cloud数据库迁移或已有tRPC合同。

本地传输增加connectExisting：只读已有owner-only目录/配置/凭据和已认证私有socket，拒绝缺失、停止、导入中的backend；不创建配置、启动supervisor或复活已停止运行。LocalNamespaceBackend复用原选择revision与晚回复代理关闭检查；旧注入实现没有此能力时拒绝恢复，不能退回普通connect。DirectConnectionManager支持本地现有连接/只连接现有后端，保留原维护状态/frozen检查、身份核验和代际边界；窗口恢复和自动重连均使用existing-only，明确用户连接仍保留原启动路径。原新namespace默认disabled，必须通过现有Start明确启动；没有为了测试绕过这一行为。恢复不会运行预设、创建PTY或重放命令。

TDD覆盖本地原窗口入口、A/B独立布局和持久化、SSH视图保留、晚写拒绝、坏归档拒写、owner边界、Forget及namespace删除清理、切换失败回滚、现有后端复用/不存在不启动/停止不复活和维护状态。初次manager/coordinator测试夹具分别使用了不合法local ID和非UUID身份，原始失败日志保留；修正夹具后分别取得旧manager拒绝本地恢复、旧coordinator不记录本地目标的实际行为失败再转绿，不把夹具错误单独当成功的回归基线。最终本地界面/存储44项154断言/5文件、shared界面/安全61项295断言/4文件、传输53项226断言/4文件通过；desktop及direct-connection类型、插件检查、17语言检查/严格编译及完整CLI/5个PTY marker构建通过，lint无错误并保留既有/测试非空断言提示。[阶段四十五红绿与检查](evidence/local-ssh-feature-parity/stage45)。 推送前检查另发现测试类型标注导致的格式错误；仅格式化该测试后14项53断言回归通过，原始格式失败日志亦保留。

第157轮未进入应用验收：旧X服务已退出，Electron报告Missing X server，退出1。新建拥有的:118测试显示后，第158轮旧产品9a69fd434/脚本0036bc15f通过Local Device/New session显示旧编辑器，原窗口断言退出1。第159轮产品ab68157c4已显示原窗口与分屏，但脚本把Manage误定位成button:first-child；第160轮修正后遇到namespace输入处于视口以下；两轮均原样退出1，失败截图已查看，只修脚本为first-of-type与真实滚轮滚入。第161轮已切换新namespace，但直接Connect按原设计拒绝已停止backend，退出1且截图已查看；后续脚本通过实际Start后连接。[157–161失败原件](evidence/local-ssh-feature-parity/source-linux-local-workspace-failures)。

第162轮A/B独立工作区、切回A的原布局与两边PTY保持通过，但重开后的调试端口被拥有的本地backend/PTY后代继承旧监听FD，脚本不能连接新renderer。ss确认新main38051监听19391，19392仍由旧拥有backend/终端后代持有。只读main inspector诊断严格检查PID和appPath，实际重开窗口restore=ready、两个终端attached；该诊断JSON与capturePage截图保留且已查看。为结束已阻塞的验收，经同一核验PID正常app.quit，没有发送kill信号或改断言；脚本按Application exited原样退出1，不把诊断算完整通过。随后验收器每次启动先独占绑定两个空闲loopback端口再释放给拥有的应用，记录实际端口/renderer URL，原worktree/PID/profile/路由归属检查不变。[162调试阻塞与只读诊断](evidence/local-ssh-feature-parity/source-linux-local-workspace-failures/162)。

第163轮产品daa7d13c7/脚本0fc633631，真实Linux/Electron、无SSH夹具，`--local-parity-only`退出0。实际A新session/原终端/原纵向分屏，A的两个PID39959/39971保持；通过原namespace表单新建中文B、真实Start/Connect，B只有独立工作区/终端PID40059。切回A恢复同一布局，B仍运行；正常关闭重开，A两个终端实际附着，后端instanceId仍为f7fb964b-8c15-406f-a365-a4b0cb3edd9c。接着在A通过原脚本编辑/按钮执行四种启动计划、中文空格目录、sequential原终端先cd /tmp后按脚本目录执行和再次重开无重放；A最终9个执行全部存活，B原PID/执行ID也保持，浏览器错误为空。A返回/重开、B独立工作区三张与六张脚本截图共九张已实际查看；其余本轮捕获。[163本地完整证据](evidence/local-ssh-feature-parity/source-linux-local-workspace/163)。本轮没有要求脚本批次关闭中的额外暂停场景；此前第155轮SSH证据不混记为本地测试。

第164轮同产品/脚本，在新本地原工作区界面复验`--local-wheel-only --wheel-clipboard`退出0：normal历史、无鼠标TUI有界文本查看与上下反向小幅滚动不发键、系统鼠标选区/文字复制、真实PNG粘贴不上传/不发输入、Esc返回及原生SGR上下报告通过。历史scrollTop3426/scrollHeight4016/clientHeight494，浏览器错误为空；历史复制粘贴截图已实际查看，其余捕获。[164新本地界面滚动](evidence/local-ssh-feature-parity/source-linux-local-workspace/164)。第165轮同产品/脚本、拥有的loopback SSH `--pane-tabs-only`退出0，原新标签、组内分屏、中文改名、拥有窗口XTest驱动原HTML5排序、关闭重开及关闭组恢复原三个PTY全部通过；重开/关闭后附着截图已查看，其余捕获，浏览器错误为空。[165SSH回归](evidence/local-ssh-feature-parity/source-linux-local-workspace/165)。测试结束停止所有拥有的新profile namespace backend和SSH夹具。

阶段四十三的本地原WorkspaceWindow入口缺口至此补齐，终端/脚本/恢复有本地实际窗口证据；这不自动证明之前所有文件/Git/聊天细项在本地都已原生验收。原脚本自动触发/Run映射/快捷键/CLI、完整原栏菜单和拖动、全部原侧栏/端口/设置等仍逐项推进。真实macOS触控板/供应商Agent、10秒连接目标与签名安装包仍是独立未满足项目，不宣称已生成1.37.7 DMG。

## 阶段四十六：复用原脚本的新标签页与新工作区触发规则

原编辑器已保存applyOnNewTab/applyOnWorkspaceCreated，但工作区入口没有消费。本阶段直接复用getPresetsForTriggerField：匹配项目中有该触发标记的专属脚本优先，否则回退全局脚本，按tabOrder顺序；隐藏只影响栏显示，不取消已配置触发。New terminal/原标签栏新建按钮在用户明确创建终端标签时读取所选后端脚本目录；没有配置时保留普通空终端。Split与明确Agent启动不查/不触发新标签规则；手动执行脚本产生的新标签也不会递归触发。创建工作区的原操作成功、原视图打开且所选连接仍一致后，明确调用创建触发；普通打开、连接、恢复、重新挂载和重开不会调用它。

触发继续复用同一执行计划/命令构造和原pane store，强制target=new-tab；sequential也创建独立终端，不能把命令输入正在工作的Agent TUI。工作区创建规则沿用原空命令跳过，新标签的空命令脚本保留原空终端语义。关联Agent从所选后端V2目录解析，不使用可能重新播种的旧list；缺少对应能力时拒绝关联启动，普通终端与旧后端保持原能力守卫。目录显式空保持空，没有自动初始化/恢复默认的副作用。未修改任何host/tRPC合同或新增迁移。

所有终端动作共用同一pending action与busy边界，覆盖目录/项目/Agent只读查找、顺序执行和视图保存；同步捕获用户选择，重复点击共享当前动作，正常关闭等待整个动作。跨目标/导航的晚回复丢弃；查询失败不替换成意外空终端；丢失创建确认、目标变化或布局保存失败后停止尚未提交的后续脚本，不重试命令。元数据本身仍使用原有有界CAS重试，不重放PTY创建。原手动四模式和已有执行写入路径继续使用。

新增行为测试旧实现得到16通过4失败，固定新标签仍为空、缺少创建触发、目录读取未纳入关闭等待。增加双击/目标变化/显式空目录/分屏与Agent排除、V2关联解析/旧后端拒绝、查询失败和创建失去确认保护。另发现首个脚本布局保存失败后仍继续启动下一条，23通过1失败后补确认保存结果再继续，转绿。最终客户端65项275断言/6文件通过，包含原触发选择、原启动计划、工作区入口、共享手动模式、关闭等待、原工具栏和renderer-safety；桌面类型、插件检查、17语言严格编译及完整CLI/5个PTY marker构建通过。lint无错误，有既有/测试非空断言提示，原始日志保留。[阶段四十六红绿与检查](evidence/local-ssh-feature-parity/stage46)。

第166轮旧产品daa7d13c7/脚本1191750e8，原Radix选项有文字但没有可用DOM id，脚本在模式选择退出1；失败截图已查看，仅改为原执行验收已用的DOM位置选择器。第167轮同旧产品/脚本abaabfafe，在原编辑器实际保存sequential双命令、新标签标记，然后Split、新标签、重开，再改为工作区创建标记并新建Standalone；两个标记文件均缺失，最终新标签执行断言退出1，两个结果截图已查看，原三个PID保持。[166–167基线与脚本失败](evidence/local-ssh-feature-parity/source-linux-terminal-script-triggers-failures)。

第168轮产品b68ccb24a/旧脚本，新标签已实际运行一次；但首次重开只等SQLite布局，没有等实际附着，Reconnecting时只读文件查询失败返回null，退出1。失败及运行截图已查看，不把这个观测当作“文件被删除”或重放证明。给脚本增加原10秒有界条件内的实际attached前置，文件/布局/PID断言保留，未延长超时。[168观测不足记录](evidence/local-ssh-feature-parity/source-linux-terminal-script-triggers-failures/168)。

第169轮产品b68ccb24a/脚本ea7a9de12，真实Linux/Electron/拥有的loopback SSH `--terminal-script-triggers-only`退出0。原Switch保存新标签标记，组内Split不运行；New terminal在独立原标签执行sequential组合命令，new-tab标记只一行，重开实际附着后仍一行、布局保持。再通过原编辑器关闭新标签标记、开启创建标记，明确New session创建Standalone后created标记只一行；随后普通New terminal不触发创建规则，正常重开仍一行。原三个PTY46241/46247/46253保持，浏览器错误为空。配置后/新标签/新工作区/重开四张截图均已实际查看。[169SSH触发完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-script-triggers/169)。

第170轮同产品/脚本，独立本地`--local-parity-only --terminal-script-triggers`退出0。先执行原A/B namespace隔离、显式Start、切回A和同backend实例重开，再执行完全相同的两个触发与恢复流程，new-tab/created各仅一行；原A两个PID47176/47188保持，未选中的B执行d9ad7e91-e5f1-4c95-97c4-31166a111fde/PID47275在整个流程后仍存活，浏览器错误为空。本地创建触发/重开两张截图已实际查看，其他捕获。[170本地触发完整证据](evidence/local-ssh-feature-parity/source-linux-terminal-script-triggers/170)。

第171轮同产品/脚本、拥有的SSH，手动四模式和原脚本/普通新终端创建中的正常关闭回归退出0。拥有backend47884两次暂停时窗口均busy=true且alive=true；解除暂停后关闭重开，最终13个执行全部存活，原执行身份保持，脚本A/B仍仅对应五次明确执行，普通创建与恢复不增加标记；浏览器错误为空。两张关闭恢复后的附着截图已实际查看，暂停期间存活由held JSON记录，其余截图捕获。[171手动与关闭回归](evidence/local-ssh-feature-parity/source-linux-terminal-script-triggers/171)。所有拥有的测试backend/namespace与SSH夹具均已停止清理。

这里完成的是两个明确新建动作的触发接入，不提供强制杀死客户端后重放尚未提交脚本的机制；工作区创建请求本身尚未返回时的关闭等待仍需独立覆盖。Run映射、原栏菜单/拖动/快捷键/CLI、其他完整功能组及真实macOS/供应商Agent继续推进；1.37.7安装包尚未生成。

## 阶段四十七：创建请求和后续动作完成后才批准正常关闭

阶段四十六仅覆盖创建回复后已经开始的终端动作。本阶段实际暂停拥有的后端，在New session请求等待中正常关闭窗口，发现旧产品会提前退出；主进程500ms仅用于元数据flush兜底，不能代替完整操作的关闭保护。复用现有单一WorkstationCloseGuard，增加beforeClose等待；明确createSession通过原ui.operation的可选waitOnClose记录完整创建、刷新、打开视图和创建触发。随后等待原views.flush的终端动作和元数据队列，再处理原文件/聊天/设置草稿。普通连接/其他操作不自动加入等待，没有增加第二个IPC关闭guard或flush订阅，没有修改500ms兜底或自动重放命令。

beforeClose通过ref读取当前回调，避免root重新渲染导致关闭订阅重建和旧请求失效；原无回调路径不增加额外await，保留原卸载/晚回复测试的时序。Save All重试也等待，并检查同一请求仍有效。TDD初始9通过3失败，固定缺少flushOperations和干净窗口提前批准；首次修复10通过2失败，原未挂新回调的卸载测试发现额外微任务改变时序，保留断言修复后12项通过。最终工作区/关闭/操作hook/原脚本栏/renderer-safety共56项293断言/5文件、桌面类型检查通过；17语言严格编译、完整桌面/打包CLI及5个PTY marker构建、插件检查通过。lint无错误并保留既有/测试提示。[阶段四十七红绿与检查](evidence/local-ssh-feature-parity/stage47)。

第172轮旧产品b68ccb24a/脚本8841a9947，窗口提前退出后只读inspector探测得到Cannot find context，原样退出1；这条是观测器错误，不单独作为行为断言基线。增强观测器为严格拥有main PID/唯一窗口检查，销毁context按不存活记录诊断；创建等待截图在请求关闭前捕获。第173轮同旧产品/脚本9946cb9ab，实际Create disabled、后端50809暂停，800ms后busy=true、alive=false，正常关闭必须等待创建的原断言退出1；该等待截图已实际查看。两轮均在finally恢复拥有后端，夹具正常清理。[172–173失败原件](evidence/local-ssh-feature-parity/source-linux-creation-close-failures)。

第174轮产品/脚本9fedfac61，拥有loopback SSH、相同创建等待流程退出0。后端52565暂停800ms时busy=true、alive=true；恢复后完成创建/触发、正常关闭、重开并实际附着，新标签与创建标记各一行，原三个PTY身份保持，浏览器错误为空。请求等待及最终重开两张截图已实际查看。[174SSH创建关闭证据](evidence/local-ssh-feature-parity/source-linux-creation-close/174)。

第175轮同产品/脚本，SSH手动四模式、批次创建及普通新终端正常关闭退出0。后端53750两次暂停均busy=true、alive=true、dwellMs=800，超过原元数据兜底时长而不延长断言超时；恢复后关闭重开，13个执行全部存活，原执行身份不变，标记不因恢复增加，错误为空。两张恢复后实际附着截图已查看；暂停期间存活由两个held JSON记录。[175长动作关闭回归](evidence/local-ssh-feature-parity/source-linux-creation-close/175)。

第176轮同产品/脚本、独立本地无SSH夹具退出0：原A/B namespace隔离、明确Start、切回A和同backend实例重开后，执行同样创建关闭流程。后端55023暂停800ms仍busy/alive；恢复后两个触发各一行且不重放，A原PID55055/55067保持、未选中B的PID55158仍存活，错误为空。创建等待及最终重开两张截图已实际查看。[176本地创建关闭证据](evidence/local-ssh-feature-parity/source-linux-creation-close/176)。

第177轮同产品/脚本、拥有SSH，原未保存文件窗口关闭回归退出0：后台草稿保护、Cancel保留、window/quit同时请求合并、Save All保留CRLF、磁盘冲突继续保留窗口和草稿、明确Don't Save不写盘、重开读原盘均通过，原PID55983/55989/55995保持。原关闭提示与冲突提示两张截图已实际查看，其余截图捕获。[177原文件关闭回归](evidence/local-ssh-feature-parity/source-linux-creation-close/177)。全部拥有测试backend/namespace及SSH夹具均经原清理路径停止。

正常关闭会等待已经明确请求的创建及后续动作；强制结束进程/机器掉电不自动补跑尚未提交脚本。这里不宣称真实macOS触控板、供应商Agent、10秒连接目标或1.37.7 DMG已验收；Run映射、完整原栏交互/快捷键/CLI及其余功能组继续实施。

## 阶段四十八：原终端脚本映射到工作区 Run

原脚本编辑器已保存useAsWorkspaceRun，但工作站Run仅读取项目配置。本阶段将原selectWorkspaceRunDefinition、项目匹配、argv和关联Agent命令构造原样提取到@superset/shared，桌面旧路径保留re-export，原账号版本与工作站复用同一实现。共享包显式声明既有shell-quote及类型的同版本依赖；锁文件同时同步三个已为1.37.7的工作区包版本，不升级第三方依赖。后端从所选namespace的现有私有脚本/Agent目录只读解析，不调用会播种的旧Agent list；明确空目录保持空。原规则为可用项目专属脚本优先，再项目配置，最后全局脚本；按tabOrder取首个有命令的匹配项，隐藏仍可作Run，空命令跳过。Standalone只匹配全局脚本，目录沿用原trim和工作区默认语义，关联Agent仍用原参数/环境引用构造。

新增workspaceRun.getStateV2/startV2及workstationWorkspaceRunV2能力，旧getStateV1/startV1/stopV1合同及配置行为保留。客户端只有明确新能力才用V2，旧后端仍走V1；不要求抬高旧host最低版本，不向无能力后端试发新过程。预览与明确启动前后端重算同一命令定义版本，脚本/关联Agent改变后拒绝旧确认。继续使用原WorkspaceRunManager、持久Run记录、完成标记、信号/停止和资源附着，启动仍走原durable journal；丢失回复保留待核对，不重发命令。没有新增数据库迁移。控件沿用原WorkspaceRunControl，原Edit Run Script菜单以拥有的连接/namespace/工作区请求打开已有脚本编辑器，删除项只打开列表，不自动补建；空Standalone的Set Run也打开原列表。

后端先2通过4失败，固定缺少V2读取/启动；客户端先8通过2失败，固定Standalone没有Run/设置入口。补优先级、旧V1行为、空目录不初始化、关联Agent引用和变更拒绝、无关/空项目脚本、被覆盖的坏配置、原编辑器直接打开/删除项不重建，以及durable丢失回复测试。首次综合99通过1失败，查到新能力未从主进程转发；补能力转发、启动journal映射和durable要求后通过。原输出使用语义output并移除冗余role，保留协议/API改变时清理旧读取的effect依赖说明。最终客户端107项337断言/9文件、后端30项86断言/4文件、desktop及host类型、17语言严格编译、完整桌面/CLI/5个PTY marker构建及插件检查通过。lint无错误，有既有/测试提示。缺少新共享依赖链接的一次构建前测试错误、初始类型/格式失败及其修复日志均保留。[阶段四十八红绿与检查](evidence/local-ssh-feature-parity/stage48)。

第178轮旧产品9fedfac61/脚本81e4f7efd，在真实原脚本编辑器新增命令、勾选Run并保存；界面仍Set Run，读取定义未选脚本，原断言退出1。配置后截图已实际查看。[178原生缺口基线](evidence/local-ssh-feature-parity/source-linux-preset-run-failures/178)。第179轮产品763ee01f0/脚本694fb519e已显示Run和Edit Run Script，但验收把menuitem当作text按钮查找，退出1；第180轮改用menu driver后打开原编辑器并实际启动Run，但验收未解码filesystem的bytes/base64内容，标记断言等待失败，退出1。两张失败截图均已查看，只修菜单选择器和字节解码并新增原始kind/解码内容记录，没有改变产品、断言或超时，也不将第180轮当作标记确实未生成的证据。[179–180观测器错误](evidence/local-ssh-feature-parity/source-linux-preset-run-failures)。

第181轮同产品/脚本0e70ec553，SSH预设Run完整流程退出0：原Edit菜单打开同一脚本；首次Run、同执行重开、Stop、明确重启使标记从一行变两行、Standalone全局Run单行均通过。原PID60909/60915/60921保持，Run PID61189重开不变，错误为空，编辑/重开两张截图已查看。第182轮独立本地同流程退出0，A两个原PID61720/61732、未选B PID61820存活，Run PID61973重开保持，错误为空；重开/Standalone两张截图已查看。这两轮当时仍使用旧底部分屏，不能代表最后的独立标签布局已验收。[181–182初次执行证据](evidence/local-ssh-feature-parity/source-linux-preset-run)。

第183轮同产品/脚本，原项目配置Run回归得到真实REMIX_RUN_ACTUAL_OUTPUT且cwd正确，但Run分屏只有940×155.25，不满足原高度160断言，退出1；失败截图与几何记录均保留且已查看。核对上游useV2WorkspaceRun，首次Run本就addTab，后续替换原Run pane。本阶段将onAttach接回既有addPane(newTab:true)，替换previousTerminalId的原路径保留，未修改最小尺寸断言。新增窗口行为测试先1通过1失败，修复后窗口/原view hook共8项48断言通过，再完整客户端107项回归与构建。[183布局实际失败](evidence/local-ssh-feature-parity/source-linux-preset-run-failures/183)。

第184轮最终产品e1fb39db3/脚本0e70ec553，原项目Run/瞬时Run真实SSH回归退出0。原配置编辑、从Files启动、前台输出、正常Stop保留父shell、同pane复用、窗口/后端重启同执行、Force Stop、原布局/焦点恢复均通过；Run输出区940×504，未放宽160要求。瞬时成功0/失败17、输出附着、原pane复用、重开同PID且标记仅once/failed两行、实际Ctrl+C结束子命令而父shell存活均通过，原配置/布局恢复。原Run输出与瞬时完成两张截图已实际查看。[184原配置与瞬时Run回归](evidence/local-ssh-feature-parity/source-linux-preset-run/184)。

第185轮同最终产品/脚本，SSH预设Run全流程在独立标签重跑退出0：原PID65189/65195/65201保持，Run PID65528及执行ID重开保持；明确停止重启才新增一行，Standalone仅一行，错误为空；重开/Standalone两张截图已查看。[185最终SSH预设Run](evidence/local-ssh-feature-parity/source-linux-preset-run/185)。第186轮独立本地在进入Run之前连接B失败，后端明确仍停止，旧选择查询也返回selection changed；脚本没有确认选择已被主进程接受及Start完成，原样退出1，失败截图已查看。这不算Run执行失败，也不据此声称快速选择/Start竞态已修复。后续仅加只读选择确认、原10秒有界条件内的UI Completed确认及记录，仍只点击一次Start/Connect，不重试或绕过停止保护。[186未确认Start的失败](evidence/local-ssh-feature-parity/source-linux-preset-run-failures/186)。

第187轮同最终产品/脚本6bbfe08e6，确认所选B及明确Start完成后，本地A/B隔离、切回A、同backend实例重开和完整预设Run/Stop/明确重启/Standalone流程退出0。A原PID66596/66608、未选B PID66694继续存活，Run PID66824及执行ID重开不变，标记满足仅明确操作增加，错误为空；重开/Standalone两张截图已实际查看。全部拥有的测试backend/namespace及SSH夹具经原清理路径停止。[187最终本地预设Run](evidence/local-ssh-feature-parity/source-linux-preset-run/187)。

此阶段完成Run映射与原独立标签恢复，不将CLI、完整预设栏菜单/快捷键、跨控件快速namespace选择与Start保护或其余功能组算作完成；真实macOS/供应商Agent、10秒连接及1.37.7安装包仍需分别验收。
