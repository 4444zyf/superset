import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='2e349c5c0';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const app='apps/desktop/src/main/direct-app.ts',updated=parse(current(app));
const normalized=ts.transform(updated,[context=>{
 const visit=node=>{
  if(ts.isImportDeclaration(node)&&['./lib/ssh-direct/workstation-browser-read-channel','./lib/ssh-direct/workstation-browser-bridge-panes'].includes(node.moduleSpecifier.text))return undefined;
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>['browserReadChannels','rendererBrowserReadReady'].includes(n.name.getText(updated))))return undefined;
  if(ts.isExpressionStatement(node)) {
   const source=node.getText(updated);
   if(source.startsWith('browserReadChannels')||source.startsWith('rendererBrowserReadReady')||source.startsWith('window.webContents.on("did-finish-load"'))return undefined;
  }
  return ts.visitEachChild(node,visit,context);
 };return node=>ts.visitNode(node,visit);
}]).transformed[0];
assert.deepEqual(shape(normalized),shape(parse(before(app))));
for(const command of ['list','console']) {
 const path=`packages/cli/src/commands/browser/${command}/command.ts`,source=parse(current(path)),original=parse(before(path));
 let oldClient;
 function find(node){if(ts.isVariableStatement(node)&&node.declarationList.declarations[0].name.getText(original)==='{ client }')oldClient=node;ts.forEachChild(node,find);}find(original);assert(oldClient);
 const result=ts.transform(source,[context=>{
  const visit=node=>{
   if(ts.isImportDeclaration(node)&&['@superset/shared/browser-bridge','../../../lib/direct-namespace'].includes(node.moduleSpecifier.text))return undefined;
   if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='namespace')return undefined;
   if(ts.isVariableStatement(node)) {
    const declaration=node.declarationList.declarations[0];
    if(declaration.name.getText(source)==='direct')return undefined;
    if(declaration.name.getText(source)==='client')return oldClient;
   }
   if(ts.isVariableDeclaration(node)&&ts.isConditionalExpression(node.initializer))return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.visitNode(node.initializer.whenFalse,visit));
   if(ts.isNonNullExpression(node)&&node.expression.getText(source)==='client')return node.expression;
   return ts.visitEachChild(node,visit,context);
  };return node=>ts.visitNode(node,visit);
 }]).transformed[0];
 assert.deepEqual(shape(result),shape(original),command);
}
const resolver='packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts';
assert.equal(current(resolver).replace('\t["direct.browserReadV1", "workstationBrowserReadBridgeV1"],\n',''),before(resolver));
const unchanged={};
for(const path of ['packages/cli/src/commands/browser/shared.ts','packages/cli/src/commands/middleware.ts','packages/cli/src/lib/resolve-auth.ts','packages/direct-connection/src/manager.ts','apps/desktop/src/main/lib/ssh-direct/workstation-controller.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-bridge-panes.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-registry.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-navigation.ts','packages/host-service/src/app.ts','packages/host-service/src/trpc/index.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/terminal/env.ts','packages/host-service/src/terminal/terminal.ts','packages/shared/src/host-version.ts']){
 assert.equal(current(path),before(path),path);unchanged[path]=createHash('sha256').update(current(path)).digest('hex');
}
writeFileSync('/workspace/scratch/parity-101/compatibility-proof.json',JSON.stringify({base,mainOnlyAddsOwnedReadChannelAndLifecycle:true,legacyBrowserCommandBodyAndOutputAstPreserved:true,namespaceOnlyAddsGuardedReadWhitelistEntry:true,unchanged},null,2)+'\n');
console.log('Legacy app/CLI AST preserved after additive scope channel and namespace branch removal; RPC/auth/SSH/terminal/framing/floor unchanged');
