import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='/workspace/superset/',base='18407b6062eab205b92cb29eca45bcb8c955dbf5',p='apps/desktop/src/renderer/routes/_authenticated/settings/browser/components/BrowserSettings/BrowserSettings.tsx';
const parse=s=>ts.createSourceFile('code.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),read=p=>readFileSync(root+p,'utf8');
function find(t,p){let r;function visit(n){if(p(n))r=n;ts.forEachChild(n,visit);}visit(t);assert.ok(r);return r;}
function shape(n){
 if(ts.isJsxAttribute(n)&&n.name.getText()==='onClick')return 'import-click';
 if(ts.isJsxElement(n)&&n.openingElement.tagName.getText()==='Trans')return ['Trans',n.children.map(c=>ts.isJsxText(c)?c.text:ts.isJsxExpression(c)&&c.expression?.getText()==='productName'?'Superset':ts.isJsxExpression(c)&&c.expression&&ts.isStringLiteral(c.expression)?c.expression.text:assert.fail('Unexpected Trans child')).join('').replace(/\s+/g,' ').trim()];
 if(ts.isJsxText(n)){const v=n.text.replace(/\s+/g,' ').trim();return v?['text',v]:null;}
 const ch=[];ts.forEachChild(n,c=>{const v=shape(c);if(v)ch.push(v);});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];
}
const before=old(p),originalRow=find(parse(before),n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.initializer?.getText()==='"flex items-center justify-between gap-4"'));
const view='apps/desktop/src/renderer/routes/_authenticated/settings/browser/components/BrowserSettings/components/BrowserImportSettingView/BrowserImportSettingView.tsx',newRow=find(parse(read(view)),n=>ts.isReturnStatement(n)&&n.expression&&ts.isParenthesizedExpression(n.expression)).expression.expression;
assert.deepEqual(shape(originalRow),shape(newRow));
const after=read(p),removeImports=s=>s.replace(/^import \{ (Button|TbDownload|BrowserImportSettingView) \}.*\n/gm,'').replace(/\s+/g,' ').trim();
const origIf=find(parse(before),n=>ts.isJsxExpression(n)&&n.expression&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText()==='showImportHistory');
const newIf=find(parse(after),n=>ts.isJsxExpression(n)&&n.expression&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText()==='showImportHistory');
assert.equal(removeImports(before.replace(origIf.getText(),'IMPORT_SETTING_ROW')),removeImports(after.replace(newIf.getText(),'IMPORT_SETTING_ROW')));
const unchanged={};for(const f of ['apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/shared/browser-import.ts','apps/desktop/src/renderer/components/ImportHistoryDialog/components/ImportHistoryDialogView/ImportHistoryDialogView.tsx','apps/desktop/src/main/lib/browser/browser-import-service.ts','apps/desktop/src/main/lib/browser/browser-history-repository.ts','apps/desktop/src/lib/trpc/routers/browser-history/index.ts']){assert.equal(read(f),old(f));unchanged[f]=createHash('sha256').update(read(f)).digest('hex');}
writeFileSync('/workspace/scratch/parity-89/extraction-proof.json',JSON.stringify({base,originalSettingRowPreservedExceptBrandAndCallback:true,legacySearchVisibilityStateAndRpcUnchanged:true,unchanged,privateContractAndStorageUnchanged:true},null,2)+'\n');console.log('Original setting row, legacy behavior, dialog, import service and released router preserved');
