import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='393d9e64a';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function find(source,predicate){let result;function visit(n){if(predicate(n))result=n;ts.forEachChild(n,visit);}visit(source);assert(result);return result;}
function compare(path,create){const old=parse(before(path)),source=parse(current(path));const normalized=ts.transform(source,[context=>{const visit=node=>create(node,visit,context,source,old);return node=>ts.visitNode(node,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(old),path);}
compare('packages/cli/src/commands/browser/navigate/command.ts',(node,visit,context,source)=>{
 if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text.includes('/direct-namespace'))return undefined;
 if(ts.isPropertyAssignment(node)&&['namespace','operationId'].includes(node.name.getText(source)))return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='await navigateDirectNamespace(options)')return undefined;
 return ts.visitEachChild(node,visit,context);
});
compare('packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts',(node,visit,context,source,old)=>{
 if(ts.isFunctionDeclaration(node)&&['resolveDirectNamespace','resolveBrowserNavigationNamespace'].includes(node.name?.text))return undefined;
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='resolveNamespace'){
  const previous=find(old,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='resolveDirectNamespace');
  return ts.factory.updateFunctionDeclaration(previous,previous.modifiers,previous.asteriskToken,previous.name,previous.typeParameters,previous.parameters,previous.type,ts.visitNode(node.body,visit));
 }
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>n.name.getText(source)==='navigation'))return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='navigation')return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source).includes('url.origin !== origin'))return find(old,n=>ts.isIfStatement(n)&&n.expression.getText(old).includes('url.origin !== origin'));
 if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='readProcedures'){
  const previous=find(old,n=>ts.isVariableDeclaration(n)&&n.name.getText(old)==='readProcedures');
  const rows=node.initializer.arguments[0].elements;assert.equal(rows[0].elements[0].text,'direct.operationStatus');
  assert.deepEqual(shape(ts.factory.updateArrayLiteralExpression(node.initializer.arguments[0],rows.slice(1))),shape(previous.initializer.arguments[0]));
  return previous;
 }
 return ts.visitEachChild(node,visit,context);
});
const paths=execFileSync('git',['diff','--name-only',base],{cwd:root,encoding:'utf8'}).trim().split('\n');
const allowed=new Set(['packages/cli/src/commands/browser/operation-status/command.ts','packages/cli/src/lib/direct-namespace/browser-navigation.ts','apps/desktop/scripts/verify-workstation-browser-navigation-cli-ui.mjs','packages/cli/src/commands/browser/navigate/command.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.test.ts','packages/i18n/lingui.config.ts','apps/desktop/scripts/verify-workstation-browser-ui.mjs']);
for(const p of paths)assert(allowed.has(p)||/^packages\/i18n\/locales\/[^/]+\/messages.po$/.test(p),p);
const proof={base,legacyNavigateAstEqual:true,legacyNamespaceIdentityAndTransportAstEqualAfterDeclaredAdditions:true,backendSharedAuthJournalSshTerminalBytesUnchanged:true,changedTrackedFiles:paths};
writeFileSync('/workspace/scratch/parity-105/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
