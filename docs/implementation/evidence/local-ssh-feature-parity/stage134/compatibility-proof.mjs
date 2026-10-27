import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset',base='f85241573',read=p=>readFileSync(root+'/'+p,'utf8'),old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),parse=s=>ts.createSourceFile('f.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const children=[];ts.forEachChild(n,c=>{children.push(shape(c));});return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];}
assert.notDeepEqual(shape(parse('const first=1; const last=2;')),shape(parse('const first=1; const last=3;')));
const hook='apps/desktop/src/renderer/workstation/Workstation/hooks/useWorkspaceViews/useWorkspaceViews.ts';
const a=parse(old(hook)),b=parse(read(hook)),body=s=>s.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useWorkspaceViews').body;
const declarations=s=>body(s).statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]);
const da=declarations(a),db=declarations(b),excluded=new Set(['readSnapshot','saveSnapshot','drainBrowserPages','mutate']),sameDeclarations=[];
for(const decl of da){const name=decl.name.getText(a);if(excluded.has(name))continue;const found=db.find(d=>d.name.getText(b)===name);assert.ok(found,name);assert.deepEqual(shape(found),shape(decl),name);sameDeclarations.push(name);}
const returned=s=>body(s).statements.find(ts.isReturnStatement).expression;
const oldProperties=[];
for(const property of returned(a).properties){const name=property.name?.getText(a);if(name==='acceptBrowserOpen')continue;const found=returned(b).properties.find(p=>p.name?.getText(b)===name);assert.ok(found,name);assert.deepEqual(shape(found),shape(property),name);oldProperties.push(name);}
const effects=s=>body(s).statements.filter(ts.isExpressionStatement).filter(n=>!(ts.isBinaryExpression(n.expression)&&n.expression.left.getText(s)==="areaStorageRef.current"));assert.deepEqual(effects(a).map(shape),effects(b).map(shape));
const renderer='apps/desktop/src/renderer/workstation/Workstation/hooks/useWorkstationBrowserOpen/workstation-browser-open-renderer.ts';
const named=(s,name)=>{let found;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(s)===name)found=n;ts.forEachChild(n,visit);}visit(s);assert.ok(found,name);return found;};
const rendererNames=['prepare','current','offEvent','offAvailability'];for(const name of rendererNames)assert.deepEqual(shape(named(parse(read(renderer)),name)),shape(named(parse(old(renderer)),name)),name);
const provider='apps/desktop/src/renderer/workstation/Workstation/providers/WorkstationBrowsers/workstation-browsers.ts',ps=parse(read(provider));
const normalized=ts.transform(ps,[ctx=>{const visit=n=>{
if(ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='shared/workspace-view-v3')return undefined;
if(ts.isUnionTypeNode(n)&&n.types.some(t=>ts.isTypeReferenceNode(t)&&t.typeName.getText(ps)==='WorkspaceViewSnapshotV3'))return ts.factory.updateUnionTypeNode(n,n.types.filter(t=>!(ts.isTypeReferenceNode(t)&&t.typeName.getText(ps)==='WorkspaceViewSnapshotV3')));
return ts.visitEachChild(n,visit,ctx);};return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(parse(old(provider))),provider);
const previous=JSON.parse(readFileSync('/workspace/scratch/parity-133/compatibility-proof.json','utf8'));
const byteEqual=previous.existingModulesByteEqual.filter(p=>![hook,renderer].includes(p));for(const p of byteEqual)assert.equal(read(p),old(p),p);
const proof={base,fullAstTraversal:true,lastStatementMutationSmoke:true,oldHookDeclarationsDirectAstEqual:sameDeclarations,oldHookReturnedPropertiesDirectAstEqual:oldProperties,allOldHookEffectsDirectAstEqual:true,rendererScopeDeclarationsDirectAstEqual:rendererNames,browserProviderOnlyAddsAcceptedV3ParameterType:true,byteEqual,scope:'Hook opts in only explicitly, with complete V3 storage/open interfaces. Current Workstation root and PaneGrid remain unchanged and do not enable this mode. The old per-pane actions still require area-aware adaptation before activating two-area UI. No new build or native acceptance.'};
writeFileSync('/workspace/scratch/parity-134/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({oldHookDeclarations:sameDeclarations.length,oldHookReturnProperties:oldProperties.length,byteEqual:byteEqual.length,allPassed:true}));
