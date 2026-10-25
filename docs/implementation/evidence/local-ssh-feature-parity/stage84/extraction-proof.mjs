import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/workspace/superset/',base='a4dc2f4d51258ba9f615302407d3a32489eb0bc2',folder='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/ClearBrowsingDataDialog';
const parse=s=>ts.createSourceFile('source.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),old=p=>parse(execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'})),cur=p=>parse(readFileSync(root+p,'utf8'));
function find(t,p){let r;function visit(n){if(p(n))r=n;ts.forEachChild(n,visit);}visit(t);assert.ok(r);return r;}
function shape(n){
 if(ts.isCallExpression(n)){
  const method=n.expression.getText();
  const original=method==='electronTrpcClient.browserHistory.clear.mutate'?'history':method==='electronTrpcClient.browser.clearBrowsingData.mutate'?n.arguments[0].properties[0].initializer.text:null;
  const injected={'source.clearHistory':'history','source.clearCookies':'cookies','source.clearCache':'cache'}[method];
  if(original||injected)return ['clear',original??injected];
 }
 if(ts.isJsxText(n)){const s=n.text.replace(/\s+/g,' ').trim();return s?[n.kind,s]:null;}if(ts.isJsxExpression(n)&&!n.expression)return null;
 const children=[];ts.forEachChild(n,x=>{const v=shape(x);if(v)children.push(v);});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];
}
const before=old(folder+'/ClearBrowsingDataDialog.tsx'),after=cur(folder+'/components/ClearBrowsingDataDialogView/ClearBrowsingDataDialogView.tsx');
const jsx=t=>find(t,n=>ts.isReturnStatement(n)&&n.expression&&ts.isParenthesizedExpression(n.expression)&&ts.isJsxElement(n.expression.expression));
assert.deepEqual(shape(jsx(before)),shape(jsx(after)));
const clear=t=>find(t,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='handleClear').initializer;
assert.deepEqual(shape(clear(before)),shape(clear(after)));
const router='apps/desktop/src/lib/trpc/routers/browser/browser.ts',oldRouter=old(router),newRouter=cur(router);
const property=t=>find(t,n=>ts.isPropertyAssignment(n)&&n.name.getText()==='clearBrowsingData');
const handler=t=>find(property(t),n=>ts.isArrowFunction(n)&&ts.isBlock(n.body));
const helper=cur('apps/desktop/src/main/lib/browser/clear-browser-session-data.ts');
const helperBody=find(helper,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='clearBrowserSessionData').body;
assert.deepEqual(handler(oldRouter).body.statements.slice(1).map(shape),helperBody.statements.map(shape));
const input=t=>find(property(t),n=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='input').arguments[0];
assert.deepEqual(shape(input(oldRouter)),shape(input(newRouter)));
const routerObject=t=>find(t,n=>ts.isReturnStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText()==='router').expression.arguments[0];
const unchanged=[];
for(const prop of routerObject(oldRouter).properties){const name=prop.name?.getText();if(name==='clearBrowsingData')continue;const current=routerObject(newRouter).properties.find(p=>p.name?.getText()===name);assert.ok(current);assert.deepEqual(shape(prop),shape(current));unchanged.push(name);}
const main='apps/desktop/src/main/direct-app.ts',cases=t=>find(t,n=>ts.isSwitchStatement(n)&&n.expression.getText()==='action').caseBlock.clauses;
const unchangedActions=[];
for(const clause of cases(old(main))){const id=ts.isCaseClause(clause)?clause.expression.getText():'default';const current=cases(cur(main)).find(c=>(ts.isCaseClause(c)?c.expression.getText():'default')===id);assert.ok(current);assert.deepEqual(shape(clause),shape(current));unchangedActions.push(id);}
const report={base,originalDialogJsxUnchanged:true,originalClearHandlerUnchangedAfterDataSourceInjection:true,originalSessionSwitchAndResponseUnchanged:true,releasedInputSchemaUnchanged:true,otherReleasedRouterPropertiesUnchanged:unchanged,existingMainActionsUnchanged:unchangedActions};
writeFileSync('/workspace/scratch/parity-84/extraction-proof.json',JSON.stringify(report,null,2)+'\n');console.log('Original clear UI, task outcomes and session operation bodies preserved; released input and other routes/actions unchanged');
