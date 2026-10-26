import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='0685cc837';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function importBindings(n){return {type:!!n.importClause?.isTypeOnly,default:n.importClause?.name?.text,names:n.importClause?.namedBindings?.elements?.map(e=>[!!e.isTypeOnly,e.propertyName?.text,e.name.text]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};}
const checked=[];
for(const path of ['packages/shared/src/browser-bridge.ts','packages/host-service/src/direct/browser-read-bridge.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/host-service/src/types.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-bridge-panes.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts','apps/desktop/src/main/direct-app.ts']){
 const old=parse(before(path)),source=parse(current(path)),oldImports=old.statements.filter(ts.isImportDeclaration);
 const normalized=ts.transform(source,[context=>{
  const visit=node=>{
   if(ts.isImportDeclaration(node)){
    if(node.moduleSpecifier.text.includes('browser-evaluation-'))return undefined;
    const prior=oldImports.find(p=>p.moduleSpecifier.text===node.moduleSpecifier.text);assert(prior);assert.deepEqual(importBindings(node),importBindings(prior));return prior;
   }
   if(ts.isUnionTypeNode(node)){
    const types=node.types.filter(t=>!(ts.isLiteralTypeNode(t)&&['isEvaluationReady','pinEvaluation'].includes(t.literal.text)));
    return ts.factory.updateUnionTypeNode(node,types.map(t=>ts.visitNode(t,visit)));
   }
   if((ts.isPropertySignature(node)||ts.isPropertyDeclaration(node)||ts.isPropertyAssignment(node)||ts.isMethodDeclaration(node))&&['evaluationV1','evaluateV1','evaluation','evaluationReady','evaluationId','pinEvaluation','isEvaluationReady','evaluate','browserEvaluateV1','workstationBrowserEvaluationV1'].includes(node.name?.getText(source)))return undefined;
   if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>['browserBridgeEvaluateRequestSchema','evaluateResultSchema'].includes(n.name.getText(source))))return undefined;
   if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='browserBridgePacketSchema'){
    const call=node.initializer,arr=call.arguments[0];assert.equal(arr.elements.at(-1).getText(source),'evaluateResultSchema');return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[ts.factory.updateArrayLiteralExpression(arr,arr.elements.slice(0,-2))]));
   }
   if(ts.isExpressionStatement(node)&&/^(this\.evaluation\s*=|this\.evaluation\.disconnect|peer\.evaluateV1\s*=|entry\.evaluationReady\s*=)/.test(node.getText(source)))return undefined;
   if(ts.isIfStatement(node)&&['packet.type === "evaluate-result"','packet.type === "evaluate-request"'].includes(node.expression.getText(source)))return undefined;
   if(ts.isSpreadElement(node)&&/peer\.evaluateV1|this\.dependencies\.evaluationV1/.test(node.getText(source)))return undefined;
   if(ts.isSourceFile(node)){
    const result=ts.visitEachChild(node,visit,context);
    const imports=result.statements.filter(ts.isImportDeclaration);assert.equal(imports.length,oldImports.length);
    return ts.factory.updateSourceFile(result,[...oldImports,...result.statements.filter(n=>!ts.isImportDeclaration(n))]);
   }
   return ts.visitEachChild(node,visit,context);
  };return node=>ts.visitNode(node,visit);
 }]).transformed[0];
 assert.deepEqual(shape(normalized),shape(old),path);checked.push(path);
}
const untouched=['packages/host-service/src/direct/operations.ts','packages/host-service/src/trpc/index.ts','packages/host-service/src/direct/browser-navigation-transfer.ts','packages/host-service/src/direct/browser-navigation-operation.ts','packages/host-service/src/direct/browser-navigation-rpc.ts','packages/cli/src/commands/browser/eval/command.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts'];
for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,normalizedAstEqual:checked,byteEqual:untouched,additions:'Only optional evaluation packet variants, exact peer reservation, original protected durable RPC and scoped manager evaluation; original CLI still unchanged.'};
writeFileSync('/workspace/scratch/parity-107/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
