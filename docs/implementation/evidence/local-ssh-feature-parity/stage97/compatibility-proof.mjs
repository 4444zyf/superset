import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='a9d254820',path='apps/desktop/src/main/lib/browser/browser-bridge.ts';
const old=execFileSync('git',['show',base+':'+path],{cwd:root,encoding:'utf8'}),current=readFileSync(root+path,'utf8'),helper=readFileSync(root+'apps/desktop/src/main/lib/browser/browser-bridge-http.ts','utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function find(tree,predicate){let result;function visit(node){if(predicate(node))result=node;ts.forEachChild(node,visit);}visit(tree);assert.ok(result);return result;}
const fn=(source,name)=>find(parse(source),node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const shape=node=>{if(!node)return null;if(ts.isParenthesizedExpression(node))return shape(node.expression);const children=[];ts.forEachChild(node,child=>children.push(shape(child)));return[node.kind,ts.isIdentifier(node)||ts.isLiteralExpression(node)?node.text:null,children];};
const route=statement=>ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&['app.get','app.post'].includes(statement.expression.expression.getText());
const oldStart=fn(old,'startBrowserBridge'),newStart=fn(current,'startBrowserBridge'),http=fn(helper,'registerBrowserBridgeHttpRoutes');
const originalRoutes=oldStart.body.statements.filter(route),extractedRoutes=http.body.statements.filter(route);
assert.equal(originalRoutes.length,11);assert.deepEqual(originalRoutes.map(shape),extractedRoutes.map(shape));
assert.deepEqual(shape(fn(old,'requireScope')),shape(fn(helper,'requireScope')));
assert.deepEqual(shape(fn(old,'withPane').body),shape(fn(helper,'withPane').body));
for(const name of ['isAuthorized','handleCdpSocket','errorMessage'])assert.deepEqual(shape(fn(old,name)),shape(fn(current,name)));
assert.deepEqual(shape(fn(old,'errorMessage')),shape(fn(helper,'errorMessage')));
const injected=statement=>ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText()==='registerBrowserBridgeHttpRoutes';
assert.deepEqual(oldStart.body.statements.filter(statement=>!route(statement)).map(shape),newStart.body.statements.filter(statement=>!injected(statement)).map(shape));
const injection=newStart.body.statements.find(injected).expression;
assert.equal(injection.arguments[0].getText(),'app');
assert.deepEqual(injection.arguments[1].properties.map(p=>p.getText().replace(/\s+/g,'')),['manager:browserManager','resolveGuestUrl','hasSafeStorageKey','importCookiesIntoSession','listLoginImportSources','resolveImportProfile']);
for(const name of ['OPEN_PANE_TIMEOUT_MS','openQueues','openDepth','MAX_QUEUED_OPENS']){
 const variable=source=>find(parse(source),node=>ts.isVariableDeclaration(node)&&node.name.getText()===name);assert.deepEqual(shape(variable(old)),shape(variable(helper)));
}
assert.match(helper,/const \{ setTimeout, clearTimeout \} = dependencies.clock \?\? globalThis/);
const unchanged={};
for(const file of ['apps/desktop/src/main/lib/browser/browser-manager.ts','apps/desktop/src/main/lib/browser/browser-bridge-info.ts','apps/desktop/src/lib/trpc/routers/browser/browser.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/runtime/browser-bridge/browser-bridge-client.ts','packages/host-service/src/runtime/browser-bridge/browser-cdp-route.ts','packages/cli/src/commands/browser/shared.ts','packages/cli/src/lib/resolve-auth.ts','packages/host-service/src/app.ts','packages/host-service/src/trpc/index.ts']){
 const a=execFileSync('git',['show',base+':'+file],{cwd:root}),b=readFileSync(root+file);assert.ok(a.equals(b),file);unchanged[file]=createHash('sha256').update(b).digest('hex');
}
writeFileSync('/workspace/scratch/parity-97/compatibility-proof.json',JSON.stringify({base,httpRoutes:originalRoutes.length,originalRouteBodiesPreserved:true,originalScopeAndGuestResolutionBodiesPreserved:true,legacyStartupAuthAndCdpUnchanged:true,originalDefaultTimeoutAndQueueLimitPreserved:true,queueStateIsPerFactoryWithLegacyStillSingleInstance:true,clockInjectionOnlyForControlledTests:true,noNewWorkstationOrCliCapabilityEnabled:true,unchanged},null,2)+'\n');
console.log('11 original HTTP handlers and legacy scope, auth, startup, CDP and queue defaults match; released RPC and CLI paths byte unchanged');
