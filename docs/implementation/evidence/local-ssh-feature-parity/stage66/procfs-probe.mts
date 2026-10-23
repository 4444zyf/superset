import net from 'node:net';
import assert from 'node:assert/strict';
import {readProcessTable,buildProcessTrees,getListeningPortsForPids} from '/workspace/superset/packages/port-scanner/src/scanner.ts';
const server=net.createServer(socket=>socket.end());
try {
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const table=await readProcessTable();const tree=buildProcessTrees(table,[process.pid]).get(process.pid);assert.ok(tree?.includes(process.pid));
 const ports=await getListeningPortsForPids(tree);const match=ports.find(p=>p.port===address.port&&p.pid===process.pid);assert.ok(match);
 process.stdout.write(JSON.stringify({runtime:process.versions.node,ownedPid:process.pid,listeningPort:address.port,matched:match})+'\n');
} finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
