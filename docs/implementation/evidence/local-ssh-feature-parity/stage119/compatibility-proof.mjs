import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='9c2fbf0eb',before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');const parse=s=>ts.createSourceFile('f.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
function find(source,predicate){let result;function visit(n){if(predicate(n))result=n;ts.forEachChild(n,visit);}visit(source);assert(result);return result;}
const paths=['packages/host-service/src/types.ts','packages/host-service/src/trpc/router/direct/direct.ts','apps/desktop/src/main/direct-app.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-bridge-panes.ts','apps/desktop/scripts/verify-restore-controls.mjs','apps/desktop/scripts/verify-workstation-browser-ui.mjs'];
for(const path of paths){const old=parse(before(path)),source=parse(current(path));
 const normalized=ts.transform(source,[ctx=>{const visit=n=>{
  if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text.includes('browser-reload-'))return undefined;
  if((ts.isPropertyAssignment(n)||ts.isPropertySignature(n))&&['reloadV1','reloadReady','reloadId','workstationBrowserReloadV1','browserReloadV1'].includes(n.name?.getText(source)))return undefined;
  if(ts.isMethodDeclaration(n)&&['pinReload','reload','browserReloadRequest'].includes(n.name?.getText(source)))return undefined;
  if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='reloadApi')return undefined;
  if(ts.isUnionTypeNode(n)){const types=n.types.filter(t=>!(ts.isLiteralTypeNode(t)&&ts.isStringLiteral(t.literal)&&['isReloadReady','pinReload'].includes(t.literal.text)));return ts.factory.updateUnionTypeNode(n,types.map(t=>ts.visitNode(t,visit)));}
  if(ts.isSpreadElement(n)&&n.expression.getText(source).includes('this.dependencies.reloadV1'))return undefined;
  if(ts.isExpressionStatement(n)&&/^entry\.reloadReady\s*=/.test(n.expression.getText(source)))return undefined;
  if(ts.isIfStatement(n)&&(n.expression.getText(source)==='packet.type === "reload-request"'||n.expression.getText(source)==='reloadApi'||n.expression.getText(source).includes('--browser-reload-api')))return undefined;
  if(ts.isMethodSignature(n)&&n.name.getText(source)==='getWebContents'&&path.endsWith('workstation-browser-bridge-panes.ts')){
   const prior=find(old,m=>ts.isMethodSignature(m)&&m.name.getText(old)==='getWebContents');assert.deepEqual(n.parameters.map(shape),prior.parameters.map(shape));
   const t=n.type.getText(source).replaceAll(/\s/g,'');assert.equal(t,'|(Pick<Electron.WebContents,"getURL"|"getTitle"|"isLoading">&Partial<Pick<Electron.WebContents,"reload"|"reloadIgnoringCache"|"isDestroyed">>)|null');return prior;
  }
  if(ts.isArrayLiteralExpression(n))return ts.factory.updateArrayLiteralExpression(n,n.elements.map(e=>ts.visitNode(e,visit)).filter(Boolean));
  return ts.visitEachChild(n,visit,ctx);
 };return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(old),path);
}
const untouched=['packages/host-service/src/direct/operations.ts','packages/host-service/src/direct/browser-read-bridge.ts','packages/host-service/src/direct/browser-reload-operation.ts','packages/host-service/src/direct/browser-reload-transfer.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/shared/src/browser-bridge.ts','packages/shared/src/host-version.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/main/lib/browser/browser-bridge-http.ts','apps/desktop/src/renderer/workstation/Workstation/Workstation.tsx','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts'];for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,normalizedOldAstEqual:paths,optionalManagerMetadataTypeExtension:['reload','reloadIgnoringCache','isDestroyed'],byteEqual:untouched,newRpc:'Protected direct.browserReloadV1 with stable operation ID; durable and negotiated-ready capability; legacy browser.reload unchanged',noCliCommandAdded:true};writeFileSync('/workspace/scratch/parity-119/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
