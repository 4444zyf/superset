import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='0213ccce2';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function find(source,predicate){let result;function visit(n){if(predicate(n))result=n;ts.forEachChild(n,visit);}visit(source);assert(result);return result;}
function compare(path,create){const old=parse(before(path)),source=parse(current(path));const normalized=ts.transform(source,[context=>{const visit=node=>create(node,visit,context,source,old);return node=>ts.visitNode(node,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(old),path);}
compare('packages/cli/src/commands/browser/eval/command.ts',(node,visit,context,source,old)=>{
 if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text.includes('/direct-namespace'))return undefined;
 if(ts.isPropertyAssignment(node)&&['namespace','operationId'].includes(node.name.getText(source)))return undefined;
 if(ts.isVariableStatement(node)){
  const decl=node.declarationList.declarations[0],name=decl.name.getText(source);
  if(name==='direct'){assert.equal(decl.initializer.getText(source),'await evaluateDirectNamespace(options)');return undefined;}
  if(name==='client'){
   const call=find(decl,n=>ts.isCallExpression(n)&&n.expression.getText(source)==='resolveBrowserTarget');assert.deepEqual(call.arguments.map(shape),[ts.factory.createIdentifier('ctx'),ts.factory.createIdentifier('options')].map(shape));
   return find(old,n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(old)==='{ client }');
  }
  if(name==='{ result }'){
   const prior=find(old,n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(old)==='{ result }');
   const nowCall=find(decl,n=>ts.isCallExpression(n)&&n.expression.getText(source).includes('.browser.eval.mutate'));
   const oldCall=find(prior,n=>ts.isCallExpression(n)&&n.expression.getText(old).includes('.browser.eval.mutate'));
   assert.deepEqual(nowCall.arguments.map(shape),oldCall.arguments.map(shape));return prior;
  }
 }
 return ts.visitEachChild(node,visit,context);
});
compare('packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts',(node,visit,context,source,old)=>{
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='resolveBrowserEvaluationNamespace')return undefined;
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='resolveNamespace'){
  assert.equal(node.parameters.at(-1).name.getText(source),'allowEvaluation');assert.equal(node.parameters.at(-1).initializer.kind,ts.SyntaxKind.FalseKeyword);
  return ts.factory.updateFunctionDeclaration(node,node.modifiers,node.asteriskToken,node.name,node.typeParameters,node.parameters.slice(0,-1),node.type,ts.visitNode(node.body,visit));
 }
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>n.name.getText(source)==='evaluation'))return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='evaluation')return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source).includes('url.origin !== origin'))return find(old,n=>ts.isIfStatement(n)&&n.expression.getText(old).includes('url.origin !== origin'));
 return ts.visitEachChild(node,visit,context);
});
const untouched=['packages/cli/src/lib/direct-namespace/browser-navigation.ts','packages/host-service/src/direct/operations.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/shared/src/browser-bridge.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts'];
for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,legacyEvalAstEqualAfterDeclaredBranchRemoval:true,originalReadAndNavigationTransportAstEqualAfterOptionalEvaluationRemoval:true,byteEqual:untouched};writeFileSync('/workspace/scratch/parity-108/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
