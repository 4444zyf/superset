本阶段验证阶段六十五的端口准备修复。最终使用 final-local-atomic 与 final-ssh-atomic；旧产品的有效红例是 baseline-dispatch-ssh。其余各轮保留用于定位验证器问题，不算通过或产品回归。

真实 OS 浏览器启动使用每轮私有 XDG 配置和独占 Chromium profile，不修改用户默认浏览器。main 中的计数观察器调用原 shell.openExternal 并原样返回结果；同步记录可避免 OS handler 启动较晚造成的负断言假通过。正常打开由真实 Chromium 请求远端 marker 服务证明；未模拟 browser opener。浏览器本身未截图；port PNG 是 Electron 工作站截图。

端口扫描就绪查询只在拥有的 fixture 中通过原认证读取 ports.getAll；未向产品 controller 放宽过程列表。原始消息、UID/namespace/PID边界、关闭/重开、暂停/恢复、终端执行和 inactive B 检查见报告与验证器源码。产品2205文件前后哈希见 manifest 与 artifacts；CLI未重打包。

setup失败包括未先展开Port、未等扫描缓存、调用未开放的renderer过程、URL末尾斜杠规范化以及读取过早的OS启动日志/错误card选择器。首次本地最终轮暴露证明文件非原子写入，改为同目录临时文件rename后，用同一产品重新执行最终本地与SSH轮。未重试Open port，未增加超时或放宽断言。独立procfs探针的loader首次路径错误，以及请求额外注册事件的合成诊断均保留；后者没有成为产品修改或最终测试计数。
