阶段七十一：原纯PortsFooterView和Close all，明确仅当前工作区，原多端口确认/取消和逐端口所有权判断不变。旧产品可发现同一进程的两个服务端口但没有Close all，baseline-local预期失败并正常清理。

最终verified-local/verified-ssh先完成旧发现/复制/明确external/关闭forward/正常重开与pending read；SSH含20次恢复。再通过多端口确认Cancel保持服务及HTTP marker，确认后两服务端口消失，原shell及未选B保持。本地原shell自身监听端口须仍存活，并仅出现一个原保护错误；SSH没有额外shell监听，关闭无失败。自有HTTP夹具同一进程双server，原子写入加锁，SIGTERM首次切换忽略重复信号，再记录两server停止。所有对象在操作前验证为原自有shell或同一自有服务PID，不向未知PID发信号。

59项/2861断言、完整桌面类型、17语言严格编译及插件检查。无host/IPC/DB/最低版本/持久键变更；原全局Footer只抽展示，原数据/动作保持。编译文件逐一核对，CLI未重包，无安装包、密封发行归档或Actions。其他功能及真实供应商/Mac仍待验，是否查看图片见实施报告。
