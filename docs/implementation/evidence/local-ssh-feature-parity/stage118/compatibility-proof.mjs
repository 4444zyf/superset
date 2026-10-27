import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='2fffedd94';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const paths=['packages/shared/src/browser-bridge.ts','packages/host-service/src/direct/browser-read-bridge.ts'];
for(const path of paths){
 const old=parse(before(path)),source=parse(current(path));
 const normalized=ts.transform(source,[context=>{const visit=node=>{
  if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text.includes('browser-reload-'))return undefined;
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['browserBridgeReloadRequestSchema','reloadResultSchema'].includes(d.name.getText(source))))return undefined;
  if(ts.isArrayLiteralExpression(node))return ts.factory.updateArrayLiteralExpression(node,node.elements.filter(e=>!['browserBridgeReloadRequestSchema','reloadResultSchema'].includes(e.getText(source))).map(e=>ts.visitNode(e,visit)).filter(Boolean));
  if((ts.isPropertySignature(node)||ts.isPropertyAssignment(node)||ts.isPropertyDeclaration(node))&&['reload','reloadV1'].includes(node.name?.getText(source)))return undefined;
  if(ts.isMethodDeclaration(node)&&['isReloadReady','pinReload'].includes(node.name?.getText(source)))return undefined;
  if(ts.isExpressionStatement(node)&&(/^this\.reload\s*=/.test(node.expression.getText(source))||node.expression.getText(source)==='this.reload.disconnect(error)'||/^peer\.reloadV1\s*=/.test(node.expression.getText(source))))return undefined;
  if(ts.isSpreadElement(node)&&node.expression.getText(source).includes('peer.reloadV1'))return undefined;
  if(ts.isIfStatement(node)&&node.expression.getText(source)==='packet.type === "reload-result"')return undefined;
  return ts.visitEachChild(node,visit,context);
 };return node=>ts.visitNode(node,visit);}]).transformed[0];
 assert.deepEqual(shape(normalized),shape(old),path);
}
const untouched=['packages/host-service/src/direct/operations.ts','packages/host-service/src/direct/browser-navigation-operation.ts','packages/host-service/src/direct/browser-navigation-transfer.ts','packages/host-service/src/direct/browser-evaluation-operation.ts','packages/host-service/src/direct/browser-open-operation.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/types.ts','packages/shared/src/host-version.ts','apps/desktop/src/main/direct-app.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-bridge-panes.ts','apps/desktop/src/preload/index.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts'];
for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,oldAstEqualAfterOnlyReloadAdditionsRemoved:paths,byteEqual:untouched,exposure:'No RPC, capability advertisement, Main opt-in or CLI command added; Main does not send reloadV1'};
writeFileSync('/workspace/scratch/parity-118/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
