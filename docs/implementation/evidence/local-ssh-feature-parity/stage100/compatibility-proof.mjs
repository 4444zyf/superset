import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='90a2e8bf9';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
function replace(s,a,b=''){ assert.equal(s.split(a).length-1,1,a); return s.replace(a,b); }
let app=current('packages/host-service/src/app.ts');
assert(app.indexOf('app.use("/direct/*", wsAuth)') < app.indexOf('registerDirectBrowserReadRoute({'));
app=replace(app,'import { registerDirectBrowserReadRoute } from "./direct/browser-read-route";\n');
app=replace(app,'import type { DirectBrowserReadBridge } from "./direct/browser-read-bridge";\n');
app=replace(app,'\t\tdirectBrowserReads?: DirectBrowserReadBridge;\n');
app=replace(app,'await supportsWorkspaceRestore(), config.directBrowserReads','await supportsWorkspaceRestore()');
app=replace(app,'\tif (isDirect && config.directBrowserReads)\n\t\tregisterDirectBrowserReadRoute({\n\t\t\tapp,\n\t\t\tupgradeWebSocket,\n\t\t\tbridge: config.directBrowserReads,\n\t\t});\n');
app=replace(app,'\t\t\t\t\tdirectBrowserReads: config.directBrowserReads,\n');
assert.equal(app,before('packages/host-service/src/app.ts'));
let runtime=current('packages/host-service/src/direct/runtime.ts');
for(const extra of ['import { DirectBrowserReadBridge } from "./browser-read-bridge";\n','\tlet browserReads: DirectBrowserReadBridge | null = null;\n','\t\tbrowserReads = new DirectBrowserReadBridge(identity);\n','\t\t\t\tdirectBrowserReads: browserReads,\n','\t\t\t\tbrowserReads?.dispose();\n','\t\tbrowserReads?.dispose();\n'])runtime=replace(runtime,extra);
assert.equal(runtime,before('packages/host-service/src/direct/runtime.ts'));
let types=current('packages/host-service/src/types.ts');
types=replace(types,'import type { DirectBrowserReadBridge } from "./direct/browser-read-bridge";\n');
types=replace(types,'\tdirectBrowserReads?: Pick<\n\t\tDirectBrowserReadBridge,\n\t\t"isReady" | "listPanes" | "console"\n\t>;\n');
assert.equal(types,before('packages/host-service/src/types.ts'));
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const original=parse(before('packages/host-service/src/trpc/router/direct/direct.ts'));
const updated=parse(current('packages/host-service/src/trpc/router/direct/direct.ts'));
const addedNames=new Set(['browserReadV1','workstationBrowserReadBridgeConnectV1','workstationBrowserReadBridgeV1']);
const normalized=ts.transform(updated,[context=>{
 const visit=node=>{
  if(ts.isImportDeclaration(node)&&['../../../direct/browser-read-bridge','@superset/shared/browser-bridge'].includes(node.moduleSpecifier.text))return undefined;
  if(ts.isParameter(node)&&node.name.getText(updated)==='browserReads')return undefined;
  if(ts.isPropertyAssignment(node)&&addedNames.has(node.name.getText(updated)))return undefined;
  if(ts.isCallExpression(node)&&node.expression.getText(updated)==='describeDirectBackend')return ts.factory.updateCallExpression(node,node.expression,node.typeArguments,node.arguments.slice(0,3));
  return ts.visitEachChild(node,visit,context);
 };return node=>ts.visitNode(node,visit);
}]).transformed[0];
assert.deepEqual(shape(normalized),shape(original));
const p='packages/host-service/package.json',oldPackage=JSON.parse(before(p)),newPackage=JSON.parse(current(p));
assert.equal(newPackage.scripts['test:integration:direct'],oldPackage.scripts['test:integration:direct']+' src/direct/browser-read-route.node-test.ts');
newPackage.scripts['test:integration:direct']=oldPackage.scripts['test:integration:direct'];assert.deepEqual(newPackage,oldPackage);
const unchanged={};
for(const path of ['packages/host-service/src/trpc/index.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/runtime/browser-bridge/browser-bridge-client.ts','packages/host-service/src/runtime/browser-bridge/browser-cdp-route.ts','packages/host-service/src/providers/host-auth/PskHostAuthProvider/PskHostAuthProvider.ts','packages/host-service/src/terminal/env.ts','packages/host-service/src/terminal/terminal.ts','packages/shared/src/host-version.ts','packages/direct-connection/src/manager.ts','packages/cli/src/commands/browser/shared.ts','packages/cli/src/lib/resolve-auth.ts','apps/desktop/src/main/lib/ssh-direct/workstation-controller.ts','apps/desktop/src/shared/direct-workstation.ts']){
 assert.equal(before(path),current(path),path);unchanged[path]=createHash('sha256').update(current(path)).digest('hex');
}
writeFileSync('/workspace/scratch/parity-100/compatibility-proof.json',JSON.stringify({base,originalAppAuthRouteOrderAndContextPreserved:true,newWebSocketRouteAfterOriginalDirectWsAuth:true,originalDirectRpcAndCapsAstPreserved:true,onlyOptionalReadBridgeContextAndLifecycleAdded:true,nodeIntegrationTaskRegistered:true,unchanged},null,2)+'\n');
const snapshot=JSON.parse(readFileSync('/workspace/scratch/parity-96/product-snapshot.json','utf8')),fixtures=JSON.parse(readFileSync('/workspace/scratch/parity-96/choice-fixture-snapshot.json','utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const changed=snapshot.files.filter(f=>sha(root+'apps/desktop/dist/'+f.path)!==f.sha256);
const changedFixtures=Object.entries(fixtures).filter(([p,h])=>sha(root+p)!==h);
const cli=sha(root+'apps/desktop/dist/resources/bin/superset');
assert.deepEqual(changed,[]);assert.deepEqual(changedFixtures,[]);assert.equal(cli,'f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb');
writeFileSync('/workspace/scratch/parity-100/unbuilt-product-check.json',JSON.stringify({productSource:snapshot.sourceCommit,fileCount:snapshot.files.length,productChanged:changed,fixtureCount:Object.keys(fixtures).length,fixturesChanged:changedFixtures,cliSha256:cli,x163SocketPresent:existsSync('/tmp/.X11-unix/X163')},null,2)+'\n');
console.log('Original RPC/auth/transport preserved; additive authenticated read bridge and lifecycle only; product/fixtures/CLI unchanged');
