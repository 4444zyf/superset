# Superset Remix workflow policy

2026-10-20（北京时间）。用户要求关闭继承的自动任务，只有明确要求生成安装包时才打包。

日常开发使用本地测试与必要的定向编译。推送代码、同步上游、PR、tag、Release、定时器或自动目标续接都不授权生成安装包或发布。此前要求过一次DMG不构成后续打包授权；遇到额度或Actions限制后不自动重试、重新启用工作流或改用另一条远端打包路径。

## 源码中的入口

`.github/workflows/`只保留两个手动入口：CI与Release SSH Desktop Preview；两者都只有workflow_dispatch。原CI检查保留，增加本策略检查，不再响应push或PR。预览不再响应预览分支推送；publish和三种重复基准输入默认均为false。发布job只在手动明确选择publish时运行。

build-cli、build-desktop、build-direct和build-direct-preview保留原workflow_call合同，只作为可复用步骤，不会自行触发。原生架构构建、后端签名校验、安装包验证等步骤保持。

其余14份上游专用流程原样移入`.github/upstream-workflows/`保存，GitHub不会发现该目录：云部署及清理、移动端E2E、Sandbox、issue/PR自动化、定时Canary、Desktop/CLI自动发布、Lockstep和Homebrew。没有删除原流程实现，也没有更改上游仓库。

运行`bun run check:workflows`可检查全部有效YAML，拒绝自动事件、额外手动入口、重复基准/发布默认打开，以及失效的本地可复用workflow引用。

## 当前仓库状态

2026-10-20已通过GitHub API停用仓库当时登记的全部4个工作流：CI、Deploy Preview、Sandbox、Release SSH Desktop Preview；随后读回均为disabled_manually。此停用对仓库所有分支生效，避免默认分支或旧分支上的历史触发器继续执行。源码修改位于当前1.37.7分支，未直接改写main。

没有触发新的构建、修改付费额度或重新启用仓库级Actions。仓库级Actions禁用/额度问题是否已解除须另外确认；停用工作流不会恢复已消耗额度。最近可见运行主要为手动预览构建，不把GitHub禁用原因直接归因于上游任务。

## 下一次明确要求打包时

仅在用户提出新的打包要求后，检查Actions/额度可用性，按需要启用Release SSH Desktop Preview这一个入口并在指定源码分支手动运行；遵守仓库说明中的启用后同步等待。上游流程保持停用，默认不重复性能基准；发布也须在用户请求范围内。不因本策略变更或功能测试自动执行此步骤。
