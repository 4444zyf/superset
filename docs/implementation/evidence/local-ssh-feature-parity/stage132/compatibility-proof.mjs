import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset',base='c0812e83e';
const old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),read=p=>readFileSync(root+'/'+p,'utf8'),parse=s=>ts.createSourceFile('f.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const children=[];ts.forEachChild(n,c=>{children.push(shape(c));});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];}
assert.notDeepEqual(shape(parse('const first=1; const last=2;')),shape(parse('const first=1; const last=3;')));
const paths=['apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/main/lib/ssh-direct/workspace-restore-coordinator.ts','apps/desktop/src/shared/workstation-browser-open.ts'];
for(const p of paths){const source=parse(read(p)),before=parse(old(p));const normalized=ts.transform(source,[ctx=>{const visit=n=>{
if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='./workspace-view-v3')return undefined;
if(ts.isImportSpecifier(n)&&n.name.text==='browserOpenSaveV3Schema')return undefined;
if((ts.isMethodDeclaration(n)||ts.isMethodSignature(n))&&['saveBrowserOpenV3','saveViewV3'].includes(n.name.getText(source)))return undefined;
if(ts.isCaseClause(n)&&ts.isStringLiteral(n.expression)&&n.expression.text==='saveBrowserOpenViewV3')return undefined;
if(ts.isPropertyAssignment(n)&&n.name.getText(source)==='saveViewV3')return undefined;
if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='browserOpenSaveV3Schema'))return undefined;
return ts.visitEachChild(n,visit,ctx);
};return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(before),p);}
const runtime='apps/desktop/src/renderer/workstation/Workstation/utils/workstation-pane-runtime/workstation-pane-runtime.ts';
const find=(source,name)=>source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
for(const name of ['structure','key','preserveRuntimePanePins']){
 if(name==='key')continue;
 assert.deepEqual(shape(find(parse(read(runtime)),name)),shape(find(parse(old(runtime)),name)),name);
}
const unchanged=['apps/desktop/src/main/lib/ssh-direct/workspace-view-store.ts','apps/desktop/src/main/lib/ssh-direct/workspace-view-area-merge.ts','apps/desktop/src/shared/workspace-view.ts','apps/desktop/src/shared/workspace-view-v2.ts','apps/desktop/src/shared/workspace-view-v3.ts','apps/desktop/src/shared/direct-workstation.ts','apps/desktop/src/renderer/workstation/Workstation/hooks/useWorkspaceViews/useWorkspaceViews.ts','apps/desktop/src/renderer/workstation/Workstation/components/WorkspaceWindow/WorkspaceWindow.tsx','apps/desktop/src/renderer/workstation/Workstation/components/WorkspaceWindow/components/PaneGrid/PaneGrid.tsx','apps/desktop/src/renderer/workstation/Workstation/utils/workspace-browser-open/workspace-browser-open-view.ts','apps/desktop/src/renderer/workstation/Workstation/utils/pane-adapter/pane-adapter.ts','apps/desktop/src/renderer/workstation/Workstation/utils/workspace-pane-state/workspace-pane-state.ts','packages/panes/src/core/store/store.ts','packages/panes/src/core/transfer/transfer.ts','packages/shared/src/host-version.ts'];
for(const p of unchanged)assert.equal(read(p),old(p),p);
const proof={base,fullAstTraversal:true,lastStatementMutationSmoke:true,oldModulesAstEqualAfterOnlyNewV3MembersRemoved:paths,runtimeFunctionsDirectAstEqual:['structure','preserveRuntimePanePins'],byteEqual:unchanged,scope:'Optional renderer paneAreas flag defaults to original V2 transport. Only complete V3 reader and guarded writer select the new path. The current Workstation root does not activate it. No UI integration or new native acceptance claimed.'};
writeFileSync('/workspace/scratch/parity-132/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
