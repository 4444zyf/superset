import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='/workspace/superset/',base='6fcec17ce088b3dc475d2fea19819099a1e584a9';
const parse=s=>ts.createSourceFile('source.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),old=p=>parse(execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'})),cur=p=>parse(readFileSync(root+p,'utf8'));
function find(t,p){let r;function visit(n){if(p(n))r=n;ts.forEachChild(n,visit);}visit(t);assert.ok(r);return r;}
function shape(n){
 if(ts.isIdentifier(n)&&n.text==='localDb'||ts.isPropertyAccessExpression(n)&&n.getText()==='this.db')return ['db'];
 if(ts.isPropertyAccessExpression(n)){
  const text=n.getText();if(text==='shell.showItemInFolder'||text==='this.dependencies.showInFolder')return ['reveal'];if(text==='shell.openPath'||text==='this.dependencies.openFile')return ['open'];
 }
 if(ts.isStringLiteral(n))return ['string',n.text];
 if(ts.isTemplateExpression(n)&&n.templateSpans.length===1&&n.templateSpans[0].expression.getText()==='kind')return ['string',n.head.text+'history'+n.templateSpans[0].literal.text];
 if(ts.isParenthesizedExpression(n))return shape(n.expression);
 if(ts.isJsxExpression(n)&&n.expression&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText()==='failed'){assert.ok(n.expression.right.getText().includes('role="alert"'));return null;}
 if(ts.isConditionalExpression(n)&&n.condition.getText()==='failed'){assert.equal(n.whenTrue.kind,ts.SyntaxKind.NullKeyword);return shape(n.whenFalse);}
 if(ts.isJsxText(n)){const s=n.text.replace(/\s+/g,' ').trim();return s?[n.kind,s]:null;}if(ts.isJsxExpression(n)&&!n.expression)return null;
 const children=[];ts.forEachChild(n,x=>{const v=shape(x);if(v)children.push(v);});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];
}
const manager='apps/desktop/src/main/lib/browser/download-manager.ts',core='apps/desktop/src/main/lib/browser/download-manager-core.ts',before=old(manager),after=cur(core);
const method=(t,name)=>find(t,n=>ts.isMethodDeclaration(n)&&n.name?.getText()===name).body;
const preservedMethods=['reserveSavePath','list','getById','cancel','showInFolder','openFile'];for(const name of preservedMethods)assert.deepEqual(shape(method(before,name)),shape(method(after,name)));
function queries(t){const out=[];function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='run'&&/^(localDb|this\.db)\./.test(n.getText()))out.push(shape(n));ts.forEachChild(n,visit);}visit(method(t,'start'));return out;}
assert.deepEqual(queries(before),queries(after));
const schema='packages/local-db/src/schema/schema.ts',newSchema='packages/local-db/src/schema/downloads.ts';
for(const name of ['downloads'])assert.deepEqual(shape(find(old(schema),n=>ts.isVariableDeclaration(n)&&n.name.getText()===name)),shape(find(cur(newSchema),n=>ts.isVariableDeclaration(n)&&n.name.getText()===name)));
for(const name of ['DownloadState','InsertDownload','SelectDownload'])assert.deepEqual(shape(find(old(schema),n=>ts.isTypeAliasDeclaration(n)&&n.name.text===name)),shape(find(cur(newSchema),n=>ts.isTypeAliasDeclaration(n)&&n.name.text===name)));
const folder='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/DownloadsDialog',oldView=old(folder+'/DownloadsDialog.tsx'),newView=cur(folder+'/components/DownloadsDialogView/DownloadsDialogView.tsx');
const jsx=t=>find(t,n=>ts.isReturnStatement(n)&&n.expression&&ts.isParenthesizedExpression(n.expression)&&ts.isJsxElement(n.expression.expression));assert.deepEqual(shape(jsx(oldView)),shape(jsx(newView)));
for(const name of ['formatBytes','stateLabel'])assert.deepEqual(shape(find(oldView,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).body),shape(find(newView,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).body));
const initializer='apps/desktop/src/main/lib/browser/initialize-browser-history.ts';assert.deepEqual(shape(find(old(initializer),n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initializeBrowserHistory').body),shape(find(cur('apps/desktop/src/main/lib/browser/initialize-browser-database.ts'),n=>ts.isFunctionDeclaration(n)&&n.name?.text==='initializeBrowserDatabase').body));
const main='apps/desktop/src/main/direct-app.ts',cases=t=>find(t,n=>ts.isSwitchStatement(n)&&n.expression.getText()==='action').caseBlock.clauses,unchangedActions=[];
for(const clause of cases(old(main))){const id=ts.isCaseClause(clause)?clause.expression.getText():'default',current=cases(cur(main)).find(c=>(ts.isCaseClause(c)?c.expression.getText():'default')===id);assert.ok(current);assert.deepEqual(shape(clause),shape(current));unchangedActions.push(id);}
const unchangedFiles={};for(const p of ['packages/local-db/drizzle/0051_add_downloads.sql','apps/desktop/src/lib/trpc/routers/downloads/index.ts']){const content=readFileSync(root+p);assert.deepEqual(content,execFileSync('git',['show',base+':'+p],{cwd:root}));unchangedFiles[p]=createHash('sha256').update(content).digest('hex');}
writeFileSync('/workspace/scratch/parity-85/extraction-proof.json',JSON.stringify({base,preservedMethods,originalStartSqlQueriesUnchanged:true,downloadTableAndTypesUnchanged:true,originalDialogJsxMatchesExceptFailureState:true,formattingHelpersUnchanged:true,historyInitializerPreservedBySharedFactory:true,intentionalChanges:['retain live interrupted rows when clearing','detach and stop downloads before profile database close','guard stale item and subscription callbacks'],existingMainActionsUnchanged:unchangedActions,unchangedFiles},null,2)+'\n');console.log('Original download table, reserved paths, storage queries, display and released router preserved; lifecycle and active-clear changes recorded separately');
