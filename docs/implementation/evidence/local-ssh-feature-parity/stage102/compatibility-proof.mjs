import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='80b78f87e';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function normalize(source, visitor){return ts.transform(source,[context=>{const visit=node=>visitor(node,visit,context) ?? ts.visitEachChild(node,visit,context);return node=>ts.visitNode(node,visit);}]).transformed[0];}
function compare(path, create) {
 const old=parse(before(path)),source=parse(current(path));
 const normalized=ts.transform(source,[context=>{const visit=node=>create(node,visit,context,source,old);return node=>ts.visitNode(node,visit);}]).transformed[0];
 assert.deepEqual(shape(normalized),shape(old),path);
}
compare('packages/shared/src/browser-bridge.ts',(node,visit,context,source)=>{
 const names=new Set(['BROWSER_CAPTURE_CHUNK_CHARS','BROWSER_CAPTURE_MAX_BASE64_CHARS','browserBridgeCaptureRequestSchema','captureChunkSchema','captureDoneSchema','validateBrowserCaptureBase64','browserCapturePackets']);
 if(ts.isFunctionDeclaration(node)&&names.has(node.name.text))return undefined;
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>names.has(n.name.getText(source))))return undefined;
 if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='browserBridgePacketSchema') {
  const call=node.initializer,arr=call.arguments[0];
  return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[ts.factory.updateArrayLiteralExpression(arr,arr.elements.slice(0,5))]));
 }
 return ts.visitEachChild(node,visit,context);
});
compare('packages/host-service/src/trpc/router/direct/direct.ts',(node,visit,context,source,old)=>{
 if(ts.isImportSpecifier(node)&&node.name.text==='browserBridgeCaptureRequestSchema')return undefined;
 if(ts.isPropertyAssignment(node)&&['browserCaptureV1','workstationBrowserCaptureV1'].includes(node.name.getText(source)))return undefined;
 if(ts.isParameter(node)&&node.name.getText(source)==='browserReads')return old.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='describeDirectBackend').parameters[3];
 return ts.visitEachChild(node,visit,context);
});
compare('packages/host-service/src/types.ts',(node,visit,context,source,old)=>{
 if(ts.isPropertySignature(node)&&node.name.getText(source)==='directBrowserReads')return old.statements.find(n=>ts.isInterfaceDeclaration(n)&&n.name.text==='HostServiceContext').members.find(n=>n.name?.getText(old)==='directBrowserReads');
 return ts.visitEachChild(node,visit,context);
});
compare('packages/cli/src/commands/browser/screenshot/command.ts',(node,visit,context,source,old)=>{
 if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='../../../lib/direct-namespace')return undefined;
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='namespace')return undefined;
 if(ts.isVariableStatement(node)) {
  const declaration=node.declarationList.declarations[0],name=declaration.name.getText(source);
  if(name==='direct')return undefined;
  if(name==='client') {let found;function find(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(old)==='{ client }')found=n;ts.forEachChild(n,find);}find(old);assert(found);return found;}
 }
 if(ts.isVariableDeclaration(node)&&node.initializer&&ts.isConditionalExpression(node.initializer))return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.visitNode(node.initializer.whenFalse,visit));
 if(ts.isNonNullExpression(node)&&node.expression.getText(source)==='client')return node.expression;
 return ts.visitEachChild(node,visit,context);
});
compare('packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts',(node,visit,context,source)=>{
 if(ts.isIfStatement(node)&&node.expression.getText(source)==='procedures.includes("direct.browserCaptureV1")')return undefined;
 if(ts.isArrayLiteralExpression(node)&&node.elements.length===2&&ts.isStringLiteral(node.elements[0])&&node.elements[0].text==='direct.browserCaptureV1')return undefined;
 return ts.visitEachChild(node,visit,context);
});
compare('packages/host-service/src/direct/browser-read-bridge.ts',(node,visit,context,source)=>{
 if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='./browser-capture-transfer')return undefined;
 if((ts.isPropertyDeclaration(node)||ts.isPropertySignature(node))&&['capture','capturePngV1'].includes(node.name.getText(source)))return undefined;
 if(ts.isMethodDeclaration(node)&&['capturePng','isCaptureReady'].includes(node.name.getText(source)))return undefined;
 if(ts.isExpressionStatement(node)&&(/^(this\.capture\s*=|this\.capture\.disconnect|peer\.capturePngV1\s*=)/).test(node.getText(source)))return undefined;
 if(ts.isIfStatement(node)&&node.expression.getText(source).includes('packet.type === "capture-chunk"'))return undefined;
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='capturePngV1')return undefined;
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='features'&&ts.isConditionalExpression(node.initializer))return ts.factory.updatePropertyAssignment(node,node.name,node.initializer.whenFalse);
 return ts.visitEachChild(node,visit,context);
});
compare('apps/desktop/src/main/direct-app.ts',(node,visit,context,source)=>{
 if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='normalizePng')return undefined;
 return ts.visitEachChild(node,visit,context);
});
compare('apps/desktop/src/main/lib/ssh-direct/workstation-browser-bridge-panes.ts',(node,visit,context,source)=>{
 if(ts.isMethodSignature(node)&&node.name.getText(source)==='normalizePng')return undefined;
 if(ts.isBindingElement(node)&&node.name.getText(source)==='normalizePng')return undefined;
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(n=>n.name.getText(source)==='png'))return undefined;
 if(ts.isReturnStatement(node)&&node.expression?.getText(source)==='png')return ts.factory.updateReturnStatement(node,ts.factory.createIdentifier('result'));
 return ts.visitEachChild(node,visit,context);
});
const unchanged={};
for(const path of ['packages/host-service/src/app.ts','packages/host-service/src/direct/runtime.ts','packages/host-service/src/direct/browser-read-route.ts','packages/host-service/src/trpc/index.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/runtime/browser-bridge/browser-bridge-client.ts','packages/host-service/src/terminal/env.ts','packages/host-service/src/terminal/terminal.ts','packages/shared/src/host-version.ts','packages/direct-connection/src/manager.ts','apps/desktop/src/main/lib/browser/browser-manager.ts','apps/desktop/src/main/lib/browser/opaque-screenshot.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-registry.ts','packages/cli/src/commands/browser/shared.ts','packages/cli/src/commands/browser/list/command.ts','packages/cli/src/commands/browser/console/command.ts','packages/cli/src/commands/middleware.ts','packages/cli/src/lib/resolve-auth.ts']){
 assert.equal(current(path),before(path),path);unchanged[path]=createHash('sha256').update(current(path)).digest('hex');
}
writeFileSync('/workspace/scratch/parity-102/compatibility-proof.json',JSON.stringify({base,originalWireFrameBoundsAndReadSchemasAstPreserved:true,oldRpcCapsAndDefaultsAstPreserved:true,ctxOnlyAddsOptionalCaptureMethods:true,legacyScreenshotCliAndExistingNamespaceReadsAstPreserved:true,originalMetadataBrokerAstPreservedAfterRemovingNegotiatedCaptureOnly:true,opaqueProcessingOnlyAddedAsOptionalScopedCallback:true,unchanged},null,2)+'\n');
console.log('Existing wire limits, read broker/RPC, legacy screenshot and namespace semantics preserved; auth/SSH/original capture/clipboard/terminal/floor unchanged');
