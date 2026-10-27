import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='5ea1d3988',before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const checked=[];
for(const path of ['apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/shared/workstation-browser.ts']){
 const old=parse(before(path)),source=parse(current(path));
 const normalized=ts.transform(source,[ctx=>{const visit=n=>{
  if(ts.isImportDeclaration(n)&&(n.moduleSpecifier.text.includes('workstation-browser-open')||n.importClause?.namedBindings?.elements?.some(e=>e.name.text==='resolveGuestUrl')))return undefined;
  if(ts.isPropertyAssignment(n)&&['openV1','openAvailability','pinOpen','openRequests'].includes(n.name.getText(source)))return undefined;
  if(ts.isPropertySignature(n)&&n.name.getText(source)==='openRequests')return undefined;
  if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['browserOpenRequests','browserOpenClosing'].includes(d.name.getText(source))))return undefined;
  if(ts.isExpressionStatement(n)&&/^(browserOpenRequests\s*=|browserOpenRequests\?\.|browserOpenClosing\s*=)/.test(n.expression.getText(source)))return undefined;
  if(ts.isIfStatement(n)&&n.thenStatement.getText(source)==='browserOpenRequests?.invalidate();')return undefined;
  if(ts.isCaseClause(n)&&['prepareBrowserOpen','confirmBrowserOpenReady','endBrowserOpen','completeBrowserOpen','isBrowserOpenCurrent','saveBrowserOpenView'].includes(n.expression.text))return undefined;
  return ts.visitEachChild(n,visit,ctx);
 };return n=>ts.visitNode(n,visit);}]).transformed[0];
 assert.deepEqual(shape(normalized),shape(old),path);checked.push(path);
}
const untouched=['apps/desktop/src/main/lib/ssh-direct/workspace-restore-coordinator.ts','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts','apps/desktop/src/renderer/workstation/Workstation/Workstation.tsx','packages/shared/src/browser-bridge.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/host-service/src/direct/operations.ts','packages/host-service/src/trpc/index.ts','packages/cli/src/commands/browser/open/command.ts'];for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,normalizedAstEqual:checked,byteEqual:untouched,limitations:'Main and preload bindings only; Root has no open listener or ready handshake, so open remains unavailable. No restored-open UI acceptance.'};writeFileSync('/workspace/scratch/parity-114/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
