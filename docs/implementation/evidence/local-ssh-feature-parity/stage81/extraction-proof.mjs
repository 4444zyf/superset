import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/workspace/superset/',base='e45b6ba00f1a2efb18c0216a87c9517fda595298';
const folder='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserOverflowMenu';
const ast=s=>ts.createSourceFile('view.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const old=ast(execFileSync('git',['show',base+':'+folder+'/BrowserOverflowMenu.tsx'],{cwd:root,encoding:'utf8'}));
const current=ast(readFileSync(root+folder+'/BrowserOverflowMenu.tsx','utf8'));
const view=ast(readFileSync(root+folder+'/components/BrowserOverflowMenuView/BrowserOverflowMenuView.tsx','utf8'));
const helper=ast(readFileSync(root+folder+'/utils/openAfterClose/openAfterClose.ts','utf8'));
function find(tree,predicate){let found;function visit(n){if(predicate(n))found=n;ts.forEachChild(n,visit);}visit(tree);assert.ok(found);return found;}
function shape(n){if(ts.isJsxText(n)){const text=n.text.replace(/\s+/g,' ').trim();return text?[n.kind,text]:null;}const children=[];ts.forEachChild(n,x=>{const value=shape(x);if(value)children.push(value);});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];}
const body=(tree,name)=>{const n=find(tree,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===name);return n.initializer.body;};
const handlers=['handleOpenDevTools','handlePrint','handleZoomOut','handleZoomIn','handleZoomReset','handleScreenshot','handleHardReload','handleCopyUrl','handleOpenExternal','handleOpenSettings'];
for(const name of handlers)assert.deepEqual(shape(body(old,name)),shape(body(current,name)),name);
const item=(tree,name)=>find(tree,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==='DropdownMenuItem'&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='onClick'&&a.initializer?.expression?.getText(tree)===name));
const items=['onOpenFindBar','handlePrint','handleOpenDevTools','onToggleDeviceToolbar','handleScreenshot','handleHardReload','handleCopyUrl','handleOpenExternal','handleOpenSettings'];
for(const name of items)assert.deepEqual(shape(item(old,name)),shape(item(view,name)),name);
const zoom=tree=>find(tree,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==='DropdownMenuItem'&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='onKeyDown'));
assert.deepEqual(shape(zoom(old)),shape(zoom(view)),'original zoom item and keyboard handlers');
const fn=(tree,name)=>find(tree,n=>ts.isFunctionDeclaration(n)&&n.name.text===name).body;
assert.deepEqual(shape(fn(old,'openAfterClose')),shape(fn(helper,'openAfterClose')));
const effect=tree=>find(tree,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect');
assert.deepEqual(shape(effect(old)),shape(effect(view)),'original pointer passthrough lifecycle');
const proof={base,identicalControllerBodies:handlers,identicalMenuItems:items,identicalZoomItem:true,identicalDialogDelayBody:true,identicalPointerPassthroughEffect:true};
writeFileSync('/workspace/scratch/parity-81/extraction-proof.json',JSON.stringify(proof,null,2)+'\n');console.log('Original menu handlers, items, zoom, pointer effect and dialog delay are unchanged');
