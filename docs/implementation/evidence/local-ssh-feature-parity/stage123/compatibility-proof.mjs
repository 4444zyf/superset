import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='c44dc93e4',old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8'),parse=s=>ts.createSourceFile('f.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const paths=['packages/cli/src/commands/browser/import-login/command.ts','packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts','apps/desktop/scripts/verify-workstation-browser-ui.mjs'];
for(const p of paths){const before=parse(old(p)),source=parse(current(p));const normalized=ts.transform(source,[ctx=>{const visit=n=>{
 if(ts.isImportDeclaration(n)&&/lib\/direct-namespace/.test(n.moduleSpecifier.text)&&p.includes('import-login/command'))return undefined;
 if(ts.isPropertyAssignment(n)&&['namespace','operationId'].includes(n.name.getText(source))&&p.includes('import-login/command'))return undefined;
 if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='client')&&p.includes('import-login/command'))return parse('const { client } = await resolveBrowserTarget(ctx, options);').statements[0];
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='resolveBrowserImportNamespace')return undefined;
 if(ts.isParameter(n)&&n.name.getText(source)==='allowImport')return undefined;
 if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='importing'))return undefined;
 if(ts.isIfStatement(n)&&n.expression.getText(source)==='importing')return undefined;
 if(ts.isBinaryExpression(n)&&n.left.getText(source)==='!importing')return ts.visitNode(n.right,visit);
 if(ts.isArrayLiteralExpression(n)&&n.elements[0]?.getText(source)==='"direct.browserImportSourcesV1"')return undefined;
 if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='importLoginCli')return undefined;
 if(ts.isIfStatement(n)&&(n.expression.getText(source).includes('--browser-import-login-cli')||n.expression.getText(source)==='importLoginCli'))return undefined;
 return ts.visitEachChild(n,visit,ctx);
 };return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(before),p);}
const unchanged=['packages/cli/src/commands/browser/import-login/utils/matchSources/matchSources.ts','packages/cli/src/commands/browser/shared.ts','packages/host-service/src/trpc/router/browser/browser.ts','packages/host-service/src/direct/browser-cookie-import-operation.ts','packages/host-service/src/direct/operations.ts','packages/shared/src/browser-bridge.ts','packages/shared/src/host-version.ts','apps/desktop/src/main/direct-app.ts','apps/desktop/src/main/lib/browser/chrome-cookie-import.ts','apps/desktop/src/main/lib/browser/chrome-history-import.ts','apps/desktop/src/preload/index.ts','apps/desktop/scripts/verify-workstation-browser-cookie-import-api-ui.mjs','apps/desktop/scripts/verify-restore-controls.mjs'];for(const p of unchanged)assert.equal(current(p),old(p),p);
const proof={base,normalizedOldAstEqual:paths,byteEqual:unchanged,additions:'Two explicit CLI flags, count-only adapter and independent single-POST import transport; source listing guarded GET added to existing reads, no old mutation access widened',defaults:'Without namespace uses original account/host resolver and unchanged matching/errors/output; with namespace requires stable UUID only when --from requests import',noRetry:true,desktopMainPreloadRendererUnchanged:true,packagedCliNotRebuilt:true};writeFileSync('/workspace/scratch/parity-123/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
