import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='8d3a1e7d3';
const before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');
const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const path='apps/desktop/src/main/lib/ssh-direct/workspace-restore-coordinator.ts',old=parse(before(path)),source=parse(current(path));
const normalized=ts.transform(source,[context=>{const visit=node=>{
 if(ts.isMethodDeclaration(node)&&node.name.getText(source)==='saveBrowserOpenV2')return undefined;
 if(ts.isParameter(node)&&node.name.getText(source)==='isBrowserOpenCurrent')return undefined;
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(source)==='assertBrowserOpenCurrent'))return undefined;
 if(ts.isExpressionStatement(node)&&node.expression.getText(source)==='assertBrowserOpenCurrent()')return undefined;
 return ts.visitEachChild(node,visit,context);
};return n=>ts.visitNode(n,visit);}]).transformed[0];
assert.deepEqual(shape(normalized),shape(old));
const untouched=['apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/shared/direct-workstation.ts','apps/desktop/src/shared/workstation-browser.ts','apps/desktop/src/renderer/workstation/Workstation/Workstation.tsx','apps/desktop/src/main/lib/ssh-direct/workstation-browser-read-channel.ts','packages/shared/src/browser-bridge.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/host-service/src/direct/browser-open-operation.ts','packages/host-service/src/direct/operations.ts','packages/host-service/src/trpc/index.ts','packages/cli/src/commands/browser/open/command.ts'];
for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,normalizedAstEqual:[path],byteEqual:untouched,limitations:'Internal guarded save and request identity only; main/preload/renderer remain unwired, no new open capability enabled, build or native acceptance.'};
writeFileSync('/workspace/scratch/parity-113/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
