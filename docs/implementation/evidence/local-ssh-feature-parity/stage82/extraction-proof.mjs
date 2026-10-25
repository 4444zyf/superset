import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='/workspace/superset/',base='3d12b74f389b2d370b8a811d017cd440f73e32b5';
const folder='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane';
const parse=s=>ts.createSourceFile('source.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const old=p=>parse(execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'})),cur=p=>parse(readFileSync(root+p,'utf8'));
function find(tree,predicate){let found;function visit(n){if(predicate(n))found=n;ts.forEachChild(n,visit);}visit(tree);assert.ok(found);return found;}
function shape(n){if(ts.isJsxText(n)){const text=n.text.replace(/\s+/g,' ').trim();return text?[n.kind,text]:null;}if(ts.isJsxExpression(n)&&!n.expression)return null;const children=[];ts.forEachChild(n,x=>{const v=shape(x);if(v)children.push(v);});return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];}
function body(tree,name){return find(tree,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).body;}
const source=old(folder+'/deviceToolbarStore.ts'),core=cur(folder+'/deviceToolbarStoreCore.ts');
const oldClass=find(source,n=>ts.isClassDeclaration(n)&&n.name?.text==='DeviceToolbarStoreImpl'),newClass=find(core,n=>ts.isClassDeclaration(n)&&n.name?.text==='DeviceToolbarStoreCore');
const methods=['getState','subscribe','setState','toggle','close','setDevice','toggleRotate'];
for(const name of methods){const a=oldClass.members.find(n=>n.name?.getText(source)===name),b=newClass.members.find(n=>n.name?.getText(core)===name);assert.deepEqual(shape(a.body),shape(b.body),name);}
const sync=oldClass.members.find(n=>n.name?.getText(source)==='syncEmulation').body;
const init=(tree,name)=>find(tree,n=>ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text===name).initializer;
const helper=body(core,'getDeviceToolbarSize');
assert.deepEqual(shape(init(sync,'device')),shape(init(helper,'device')),'original preset lookup/fallback');
assert.deepEqual(shape(init(sync,'params')),shape(helper.statements.find(ts.isReturnStatement).expression),'original rotation dimensions');
const toolbarPath=folder+'/components/DeviceToolbar/DeviceToolbar.tsx';
assert.deepEqual(shape(body(old(toolbarPath),'DeviceToolbar').statements.find(ts.isReturnStatement).expression),shape(body(cur(toolbarPath),'DeviceToolbar').statements.find(ts.isReturnStatement).expression),'original DeviceToolbar JSX');
const browser=old(folder+'/BrowserPane.tsx'),viewport=cur(folder+'/components/BrowserViewportView/BrowserViewportView.tsx');
const originalViewport=find(browser,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(browser)==='div'&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='className'&&a.initializer?.getText(browser).includes('overflow-auto')));
const extracted=body(viewport,'BrowserViewportView').statements.find(ts.isReturnStatement).expression;
const currentViewport=ts.isParenthesizedExpression(extracted)?extracted.expression:extracted;
const addedStyle=currentViewport.openingElement.attributes.properties.find(n=>ts.isJsxAttribute(n)&&n.name.text==='style');assert.ok(addedStyle);
const expectedStyle=parse('<div style={deviceToolbar.isOpen ? {alignItems:"safe center",justifyContent:"safe center"}:undefined}/>');
const expectedAttr=find(expectedStyle,n=>ts.isJsxAttribute(n)&&n.name.text==='style');assert.deepEqual(shape(addedStyle),shape(expectedAttr),'explicit safe overflow alignment fix');
const normalizedOpening=ts.factory.updateJsxOpeningElement(currentViewport.openingElement,currentViewport.openingElement.tagName,currentViewport.openingElement.typeArguments,ts.factory.createJsxAttributes(currentViewport.openingElement.attributes.properties.filter(n=>n!==addedStyle)));
const normalizedViewport=ts.factory.updateJsxElement(currentViewport,normalizedOpening,currentViewport.children,currentViewport.closingElement);
assert.deepEqual(shape(originalViewport),shape(normalizedViewport),'original viewport JSX apart from explicit safe alignment');
const mainPath='apps/desktop/src/main/direct-app.ts',a=old(mainPath),b=cur(mainPath);
const actions=tree=>find(tree,n=>ts.isSwitchStatement(n)&&n.expression.getText(tree)==='action').caseBlock.clauses;
const preserved=[];for(const clause of actions(a)){const name=ts.isCaseClause(clause)?clause.expression.text:'default';const next=actions(b).find(n=>(ts.isCaseClause(n)?n.expression.text:'default')===name);assert.ok(next,name);assert.deepEqual(shape(clause),shape(next),name);preserved.push(name);}
const zoomBefore=old('packages/shared/src/page-zoom.ts'),zoomAfter=cur('packages/shared/src/page-zoom.ts');
for(const name of ['PAGE_PINCH_ZOOM_RUNTIME_SOURCE','NEXT_PAGE_VIEWPORT_ZOOM_SCRIPT'])assert.deepEqual(shape(init(zoomBefore,name)),shape(init(zoomAfter,name)),name);
const hashes={};for(const path of [folder+'/constants.ts','apps/desktop/src/main/lib/browser/browser-manager.ts','apps/desktop/src/lib/trpc/routers/browser/browser.ts']){const before=execFileSync('git',['show',base+':'+path],{cwd:root}),after=readFileSync(root+path);assert.deepEqual(before,after,path);hashes[path]=createHash('sha256').update(after).digest('hex');}
writeFileSync('/workspace/scratch/parity-82/extraction-proof.json',JSON.stringify({base,identicalStateMethods:methods,identicalPresetLookup:true,identicalRotation:true,identicalDeviceToolbarJsx:true,viewportJsxMatchesExceptSafeAlignment:true,existingMainActionsUnchanged:preserved,unchangedFiles:hashes,guestZoomScriptsUnchanged:true},null,2)+'\n');console.log('Original device controls/state/IPC preserved; viewport differs only by explicit safe alignment');
