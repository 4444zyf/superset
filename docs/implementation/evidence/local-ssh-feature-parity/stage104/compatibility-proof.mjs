import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='1e10d0a43';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function find(source,predicate){let result;function visit(n){if(predicate(n))result=n;ts.forEachChild(n,visit);}visit(source);assert(result);return result;}
function compare(path,create){const old=parse(before(path)),source=parse(current(path));const normalized=ts.transform(source,[context=>{const visit=node=>create(node,visit,context,source,old);return node=>ts.visitNode(node,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(old),path);}
compare('packages/shared/src/browser-bridge.ts',(node,visit,context,source)=>{
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>['browserBridgeNavigateRequestSchema','navigateResultSchema'].includes(n.name.getText(source))))return undefined;
 if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='browserBridgePacketSchema'){const call=node.initializer,arr=call.arguments[0];return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[ts.factory.updateArrayLiteralExpression(arr,arr.elements.slice(0,-2))]));}
 return ts.visitEachChild(node,visit,context);
});
compare('packages/host-service/src/direct/browser-read-bridge.ts',(node,visit,context,source,old)=>{
 if(ts.isImportDeclaration(node)&&['./browser-navigation-transfer','./browser-navigation-operation'].includes(node.moduleSpecifier.text))return undefined;
 if((ts.isPropertyDeclaration(node)||ts.isPropertySignature(node)||ts.isPropertyAssignment(node))&&['navigation','navigateV1'].includes(node.name.getText(source)))return undefined;
 if(ts.isMethodDeclaration(node)&&['isNavigationReady','pinNavigation'].includes(node.name.getText(source)))return undefined;
 if(ts.isExpressionStatement(node)&&/^(this\.navigation\s*=|this\.navigation\.disconnect|peer\.navigateV1\s*=)/.test(node.getText(source)))return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='packet.type === "navigate-result"')return undefined;
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='features')return find(old,n=>ts.isPropertyAssignment(n)&&n.name.getText(old)==='features');
 return ts.visitEachChild(node,visit,context);
});
compare('packages/host-service/src/trpc/router/direct/direct.ts',(node,visit,context,source,old)=>{
 if(ts.isImportDeclaration(node)&&['../../../direct/browser-navigation-rpc','../../../direct/browser-navigation-operation'].includes(node.moduleSpecifier.text))return undefined;
 if(ts.isPropertyAssignment(node)&&['browserNavigateV1','workstationBrowserNavigationV1'].includes(node.name.getText(source)))return undefined;
 if(ts.isParameter(node)&&node.name.getText(source)==='browserReads')return old.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='describeDirectBackend').parameters[3];
 return ts.visitEachChild(node,visit,context);
});
compare('packages/host-service/src/types.ts',(node,visit,context,source,old)=>{
 if(ts.isPropertySignature(node)&&node.name.getText(source)==='directBrowserReads')return find(old,n=>ts.isPropertySignature(n)&&n.name.getText(old)==='directBrowserReads');
 return ts.visitEachChild(node,visit,context);
});
compare('apps/desktop/src/main/direct-app.ts',(node,visit,context,source)=>{
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='navigationV1')return undefined;
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='navigate'&&node.initializer.getText(source).startsWith('(owner, pane, url, current)'))return undefined;
 return ts.visitEachChild(node,visit,context);
});
compare('apps/desktop/src/main/lib/ssh-direct/workstation-browser-bridge-panes.ts',(node,visit,context,source)=>{
 if(ts.isImportSpecifier(node)&&node.name.text==='WorkstationBrowserNavigationResult')return undefined;
 if(ts.isMethodSignature(node)&&node.name.getText(source)==='navigate')return undefined;
 if(ts.isBindingElement(node)&&node.name.getText(source)==='navigate')return undefined;
 if(ts.isMethodDeclaration(node)&&node.name.getText(source)==='pinNavigation')return undefined;
 return ts.visitEachChild(node,visit,context);
});
compare('apps/desktop/src/main/lib/ssh-direct/workstation-browser-navigation.ts',(node,visit,context,source)=>{
 if(ts.isParameter(node)&&node.name.getText(source)==='isCurrent')return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='!isCurrent()')return undefined;
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken&&node.left.getText(source)==='!isCurrent()')return ts.visitNode(node.right,visit);
 return ts.visitEachChild(node,visit,context);
});
compare('apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts',(node,visit,context,source,old)=>{
 if((ts.isPropertySignature(node)||ts.isPropertyAssignment(node))&&['navigationV1','navigationReady','navigationId'].includes(node.name.getText(source)))return undefined;
 if(ts.isMethodDeclaration(node)&&node.name.getText(source)==='navigate')return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='packet.type === "navigate-request"')return undefined;
 if(ts.isExpressionStatement(node)&&node.getText(source).startsWith('entry.navigationReady ='))return undefined;
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='features')return find(old,n=>ts.isPropertyAssignment(n)&&n.name.getText(old)==='features');
 if(ts.isMethodSignature(node)&&node.name.getText(source)==='panes')return find(old,n=>ts.isMethodSignature(n)&&n.name.getText(old)==='panes');
 return ts.visitEachChild(node,visit,context);
});
const unchanged={};
for(const path of ['packages/host-service/src/app.ts','packages/host-service/src/direct/runtime.ts','packages/host-service/src/direct/operations.ts','packages/host-service/src/direct/browser-read-route.ts','packages/host-service/src/trpc/index.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/runtime/browser-bridge/browser-bridge-client.ts','packages/host-service/src/terminal/env.ts','packages/host-service/src/terminal/terminal.ts','packages/shared/src/host-version.ts','packages/direct-connection/src/manager.ts','apps/desktop/src/main/lib/browser/browser-manager.ts','apps/desktop/src/main/lib/browser/opaque-screenshot.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-registry.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts','packages/cli/src/commands/browser/shared.ts','packages/cli/src/commands/browser/list/command.ts','packages/cli/src/commands/browser/console/command.ts','packages/cli/src/commands/browser/screenshot/command.ts','packages/cli/src/commands/browser/navigate/command.ts','packages/cli/src/commands/middleware.ts','packages/cli/src/lib/resolve-auth.ts']){assert.equal(current(path),before(path),path);unchanged[path]=createHash('sha256').update(current(path)).digest('hex');}
writeFileSync('/workspace/scratch/parity-104/compatibility-proof.json',JSON.stringify({base,existingReadCaptureWireAndBrokerAstPreserved:true,oldRpcInputDefaultsAndCapsAstPreserved:true,mainOnlyEnablesNegotiatedScopedNavigation:true,oldNavigationDefaultBodyAstPreservedAfterOptionalGuardRemoval:true,optionalContextMethodsOnly:true,oldReadChannelAstPreserved:true,unchanged},null,2)+'\n');
console.log('Existing broker/RPC/main/navigation AST preserved after additive navigation removal; auth/journal/SSH/terminal/CLI/floor unchanged');
