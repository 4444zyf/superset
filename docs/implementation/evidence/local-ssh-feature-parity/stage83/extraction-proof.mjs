import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='/workspace/superset/',base='4675d0242ba43093a52676f460dbb2c86b7e7880',folder='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/HistoryDialog';
const parse=s=>ts.createSourceFile('source.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),old=p=>parse(execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'})),cur=p=>parse(readFileSync(root+p,'utf8'));
function find(tree,predicate){let found;function visit(n){if(predicate(n))found=n;ts.forEachChild(n,visit);}visit(tree);assert.ok(found);return found;}
function shape(n){
 if(ts.isParenthesizedExpression(n))return shape(n.expression);
 if(ts.isJsxExpression(n)&&n.expression&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText()==='failed'){assert.equal(n.expression.operatorToken.kind,ts.SyntaxKind.AmpersandAmpersandToken);assert.ok(n.expression.right.getText().includes('role="alert"'));return null;}
 if(ts.isConditionalExpression(n)&&n.condition.getText()==='failed'){assert.equal(n.whenTrue.kind,ts.SyntaxKind.NullKeyword);return shape(n.whenFalse);}
 if(ts.isJsxText(n)){const text=n.text.replace(/\s+/g,' ').trim();return text?[n.kind,text]:null;}if(ts.isJsxExpression(n)&&!n.expression)return null;
 const children=[];ts.forEachChild(n,x=>{const v=shape(x);if(v)children.push(v);});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];
}
const before=old(folder+'/HistoryDialog.tsx'),after=cur(folder+'/components/HistoryDialogView/HistoryDialogView.tsx');
const jsx=t=>find(t,n=>ts.isReturnStatement(n)&&n.expression&&ts.isParenthesizedExpression(n.expression)&&ts.isJsxElement(n.expression.expression));
assert.deepEqual(shape(jsx(before)),shape(jsx(after)));
const filter=t=>find(t,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='localFiltered').initializer;
assert.deepEqual(shape(filter(before)),shape(filter(after)));
const report={base,originalDialogJsxMatchesExceptExplicitFailureState:true,originalImmediateFilterUnchanged:true,originalDebounceMs:150,originalSearchLimit:100,unchangedFiles:{}};
for(const p of ['apps/desktop/src/shared/workstation-browser.ts','apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/main/lib/browser/browser-history-repository.ts','apps/desktop/src/lib/trpc/routers/browser-history/index.ts']){
 const content=readFileSync(root+p),original=execFileSync('git',['show',base+':'+p],{cwd:root});assert.deepEqual(content,original);report.unchangedFiles[p]=createHash('sha256').update(content).digest('hex');
}
const pane='apps/desktop/src/renderer/workstation/Workstation/components/WorkspaceWindow/components/WorkspaceBrowserPane/WorkspaceBrowserPane.tsx';
const mapping=t=>find(t,n=>ts.isConditionalExpression(n)&&n.condition.getText().includes('row.faviconUrl')&&n.whenTrue.getText()==='displayIcon');
assert.deepEqual(shape(mapping(old(pane))),shape(mapping(cur(pane))));report.canonicalHistoryIconMappingMatchesOriginal=true;
writeFileSync('/workspace/scratch/parity-83/extraction-proof.json',JSON.stringify(report,null,2)+'\n');console.log('Original dialog/filter preserved except visible failure state; shared/private/released history contracts unchanged');
