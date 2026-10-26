import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='b35696cdc';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function bindings(n,removePacket=false){return{type:!!n.importClause?.isTypeOnly,default:n.importClause?.name?.text,names:n.importClause?.namedBindings?.elements?.filter(e=>!removePacket||e.name.text!=='BrowserBridgePacket').map(e=>[!!e.isTypeOnly,e.propertyName?.text,e.name.text]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};}
const checked=[];
for(const path of ['packages/shared/src/browser-bridge.ts','packages/host-service/src/direct/browser-read-bridge.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/host-service/src/types.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts']){
 const old=parse(before(path)),source=parse(current(path)),oldImports=old.statements.filter(ts.isImportDeclaration);
 const normalized=ts.transform(source,[context=>{const visit=node=>{
  if(ts.isImportDeclaration(node)){
   if(node.moduleSpecifier.text.includes('browser-open-'))return undefined;
   const prior=oldImports.find(p=>p.moduleSpecifier.text===node.moduleSpecifier.text);assert(prior);assert.deepEqual(bindings(node,path.endsWith('workstation-browser-read-channel.ts')),bindings(prior));return prior;
  }
  if(ts.isTypeAliasDeclaration(node)&&['OpenRequest','OpenResult'].includes(node.name.text))return undefined;
  if(ts.isUnionTypeNode(node)){const types=node.types.filter(t=>!(ts.isLiteralTypeNode(t)&&['isOpenReady','pinOpen'].includes(t.literal.text)));return ts.factory.updateUnionTypeNode(node,types.map(t=>ts.visitNode(t,visit)));}
  if((ts.isPropertySignature(node)||ts.isPropertyDeclaration(node)||ts.isPropertyAssignment(node)||ts.isMethodDeclaration(node)||ts.isMethodSignature(node))&&['openV1','openScopeId','openAccepting','openTransfer','isOpenReady','pinOpen','openNegotiated','openId','openRelease','openAvailability','supportsOpen','publishOpenAvailability','sendOpenAvailability','releaseOpen','openBrowser','browserOpenV1','workstationBrowserOpenV1'].includes(node.name?.getText(source)))return undefined;
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>['browserBridgeOpenRequestSchema','openAvailabilitySchema','openResultSchema'].includes(n.name.getText(source))))return undefined;
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='browserBridgePacketSchema'){
   const call=node.initializer,arr=call.arguments[0];assert.equal(arr.elements.at(-1).getText(source),'openResultSchema');return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[ts.factory.updateArrayLiteralExpression(arr,arr.elements.slice(0,-3))]));
  }
  if(ts.isExpressionStatement(node)&&/^(this\.openTransfer\s*=|this\.openTransfer\.disconnect|peer\.openV1\s*=|entry\.openNegotiated\s*=|this\.sendOpenAvailability\(|this\.releaseOpen\()/.test(node.getText(source)))return undefined;
  if(ts.isIfStatement(node)&&['packet.type === "open-availability"','packet.type === "open-result"','packet.type === "open-request"'].includes(node.expression.getText(source)))return undefined;
  if(ts.isSpreadElement(node)&&/peer\.openV1|this\.supportsOpen\(\)/.test(node.getText(source)))return undefined;
  if(ts.isSourceFile(node)){const result=ts.visitEachChild(node,visit,context);assert.equal(result.statements.filter(ts.isImportDeclaration).length,oldImports.length);return ts.factory.updateSourceFile(result,[...oldImports,...result.statements.filter(n=>!ts.isImportDeclaration(n))]);}
  return ts.visitEachChild(node,visit,context);
 };return node=>ts.visitNode(node,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(old),path);checked.push(path);
}
const untouched=['apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/shared/workstation-browser.ts','apps/desktop/src/renderer/workstation/Workstation/Workstation.tsx','packages/host-service/src/direct/operations.ts','packages/host-service/src/trpc/index.ts','packages/cli/src/commands/browser/open/command.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts'];for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,normalizedAstEqual:checked,byteEqual:untouched,limitations:'Protocol and protected RPC core only; main does not advertise openV1 or bind a real renderer handler yet. No new build or native UI acceptance.'};writeFileSync('/workspace/scratch/parity-112/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
