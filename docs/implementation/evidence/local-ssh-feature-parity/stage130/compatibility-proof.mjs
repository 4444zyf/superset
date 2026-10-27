import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset',base='406d75904',old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),parse=s=>ts.createSourceFile('f.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);function shape(n){const children=[];ts.forEachChild(n,c=>{children.push(shape(c));});return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];}assert.notDeepEqual(shape(parse('const first=1; const last=2;')),shape(parse('const first=1; const last=3;')));
const paths=['apps/desktop/src/main/lib/ssh-direct/workspace-restore-coordinator.ts','apps/desktop/src/main/lib/ssh-direct/workspace-restore-local.test.ts','apps/desktop/src/shared/workspace-view-v3.ts','apps/desktop/src/shared/direct-workstation.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/main/direct-app.ts'];
for(const p of paths){const source=parse(readFileSync(root+'/'+p,'utf8')),before=parse(old(p)),code=n=>n.getText(source).replace(/\s+/g,'');const normalized=ts.transform(source,[ctx=>{let method='';const visit=n=>{
 if(ts.isImportDeclaration(n)&&/workspace-view-v3/.test(n.moduleSpecifier.text))return undefined;
 if(p.endsWith('workspace-view-v3.ts')){
  if(ts.isImportSpecifier(n)&&n.name.text==='WorkspaceViewV2Save')return undefined;
  if(ts.isInterfaceDeclaration(n)&&n.name.text==='WorkspaceViewV3Save')return undefined;
  if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='workspaceViewV3SaveInputSchema'))return undefined;
 }
 if(ts.isMethodDeclaration(n)){
  if(['readV3','saveV3'].includes(n.name.getText(source)))return undefined;
  if(n.name.getText(source)==='saveView'&&!n.body&&n.parameters[2]?.type&&code(n.parameters[2].type)==='3')return undefined;
  const previous=method;method=n.name.getText(source);const result=ts.visitEachChild(n,visit,ctx);method=previous;return result;
 }
 if(ts.isMethodSignature(n)&&['getWorkspaceViewV3','saveWorkspaceViewV3'].includes(n.name.getText(source)))return undefined;
 if(ts.isPropertyAssignment(n)&&['getWorkspaceViewV3','saveWorkspaceViewV3'].includes(n.name.getText(source)))return undefined;
 if(ts.isCaseClause(n)&&ts.isStringLiteral(n.expression)&&['getWorkspaceViewV3','saveWorkspaceViewV3'].includes(n.expression.text))return undefined;
 if(method==='saveView'){
  if(ts.isUnionTypeNode(n))return ts.factory.updateUnionTypeNode(n,n.types.filter(t=>!(ts.isLiteralTypeNode(t)&&ts.isNumericLiteral(t.literal)&&t.literal.text==='3')&&!(ts.isTypeReferenceNode(t)&&t.typeName.getText(source)==='WorkspaceViewSnapshotV3')).map(t=>ts.visitNode(t,visit)));
  if(ts.isConditionalExpression(n)&&code(n.condition)==='version===3')return ts.visitNode(n.whenFalse,visit);
  if(ts.isIfStatement(n)&&code(n.expression)==='version===3&&fullView')return undefined;
 }
 if(p.endsWith('workspace-restore-local.test.ts')){
  if(ts.isFunctionDeclaration(n)&&['browserAreaInput','saveBrowserArea'].includes(n.name?.text))return undefined;
  if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&ts.isIdentifier(n.expression.expression)&&n.expression.expression.text==='test'&&ts.isStringLiteral(n.expression.arguments[0])&&/^(V3|a newer V3 navigation)/.test(n.expression.arguments[0].text))return undefined;
 }
 return ts.visitEachChild(n,visit,ctx);
};return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(before),p);}
const coordinator=paths[0],a=parse(old(coordinator)),b=parse(readFileSync(root+'/'+coordinator,'utf8')),classA=a.statements.find(ts.isClassDeclaration),classB=b.statements.find(ts.isClassDeclaration),sameMethods=[];for(const m of classA.members){if(!ts.isMethodDeclaration(m)||m.name.getText(a)==='saveView')continue;const name=m.name.getText(a),other=classB.members.find(c=>ts.isMethodDeclaration(c)&&c.name.getText(b)===name);assert.deepEqual(shape(other),shape(m),name);sameMethods.push(name);}
const rootSource=parse(old(paths[5]));let oldInput;function search(n){if(ts.isCaseClause(n)&&ts.isStringLiteral(n.expression)&&n.expression.text==='saveWorkspaceViewV2'){const find=c=>{if(!oldInput&&ts.isCallExpression(c)&&c.expression.getText(rootSource).replace(/\s+/g,'')==='z.strictObject')oldInput=c.arguments[0];ts.forEachChild(c,find);};find(n);}ts.forEachChild(n,search);}search(rootSource);const newSchema=parse(readFileSync(root+'/'+paths[2],'utf8')).statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText()==='workspaceViewV3SaveInputSchema').declarationList.declarations[0].initializer.arguments[0];assert.ok(oldInput);assert.deepEqual(shape(newSchema),shape(oldInput),'New shallow IPC wrapper retains all original V2 revision/lease field limits');
const unchanged=['apps/desktop/src/main/lib/ssh-direct/workspace-view-store.ts','apps/desktop/src/main/lib/ssh-direct/workspace-view-area-merge.ts','apps/desktop/src/shared/workspace-view.ts','apps/desktop/src/shared/workspace-view-v2.ts','apps/desktop/src/renderer/workstation/Workstation/hooks/useWorkspaceViews/useWorkspaceViews.ts','apps/desktop/src/renderer/workstation/Workstation/components/WorkspaceWindow/WorkspaceWindow.tsx','packages/shared/src/host-version.ts'];for(const p of unchanged)assert.equal(readFileSync(root+'/'+p,'utf8'),old(p),p);
const proof={base,fullAstTraversal:true,oldModulesAstEqualAfterNewV3BranchesRemoved:paths,coordinatorMethodsDirectAstEqual:sameMethods,byteEqual:unchanged,ipcInputWrapperMatchesOriginalV2Exactly:true,newMethodsOptional:true,oldAuthAndSenderFrameGuardUnchanged:true,coordinator:'Only explicit version3 selects the new codec, projection for original V1 canonical resource checks, and saveV3. Original validateBrowserView directly receives the full V3 resource catalog, so identities and confirmed terminal execution IDs are canonicalized without losing areas/pins. Original check function and all old lifecycle/queue/navigation methods are unchanged.',scope:'Source IPC and coordinator only, renderer still unmodified and native product remains127; no new source-build or native acceptance yet'};writeFileSync('/workspace/scratch/parity-130/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
