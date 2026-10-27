import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset',base='8c36ef407',read=p=>readFileSync(root+'/'+p,'utf8'),old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),parse=s=>ts.createSourceFile('f.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function shape(n){const children=[];ts.forEachChild(n,c=>{children.push(shape(c));});return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];}assert.notDeepEqual(shape(parse('const first=1;const last=2;')),shape(parse('const first=1;const last=3;')));
const hook='apps/desktop/src/renderer/workstation/Workstation/hooks/useWorkspaceViews/useWorkspaceViews.ts',source=parse(read(hook)),before=parse(old(hook));
const changed=new Set(['changeWorkspace','addPane','executeTerminalPreset','saveLayout','savePaneState','focusPane','selectChat','closePane','closeBrowserPane']),code=n=>n.getText(source).replace(/\s+/g,'');
const normalized=ts.transform(source,[ctx=>{let method='';const visit=n=>{
 if(ts.isImportDeclaration(n)&&(/workspace-pane-area-edit/.test(n.moduleSpecifier.text)||n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.length===1&&n.importClause.namedBindings.elements[0].name.text==='readWorkspacePaneAreas'))return undefined;
 if((ts.isVariableDeclaration(n)||ts.isPropertyAssignment(n))&&changed.has(n.name.getText(source))){const saved=method;method=n.name.getText(source);const result=ts.visitEachChild(n,visit,ctx);method=saved;return result;}
 if(method==='changeWorkspace'){
  if(ts.isParameter(n)&&n.name.getText(source)==='paneEdit')return undefined;
  if(ts.isConditionalExpression(n)&&code(n.condition)==='areaStorage&&paneEdit?.connectionId')return ts.visitNode(n.whenFalse,visit);
  if(ts.isIfStatement(n)&&code(n.expression)==='areaStorage&&paneEdit')return undefined;
 }
 if(method==='executeTerminalPreset'){
  if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&['paneAreas','selectedArea'].includes(n.declarationList.declarations[0].name.getText(source)))return undefined;
  if(ts.isBinaryExpression(n)&&code(n)==='paneAreas?.[selectedArea]??toPaneState(workspace)')return ts.visitNode(n.right,visit);
 }
 if(method==='saveLayout'&&ts.isBinaryExpression(n)&&code(n)==='viewRef.current&&!areaStorage')return ts.visitNode(n.left,visit);
 if(method==='closeBrowserPane'&&ts.isArrowFunction(n)&&ts.isBlock(n.body)&&n.body.statements.some(s=>ts.isIfStatement(s)&&code(s.expression)==='areaStorage')){
  const tail=n.body.statements.at(-1);assert.ok(ts.isReturnStatement(tail)&&tail.expression);return ts.factory.updateArrowFunction(n,n.modifiers,n.typeParameters,n.parameters,n.type,n.equalsGreaterThanToken,ts.visitNode(tail.expression,visit));
 }
 if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='changeWorkspace'&&n.arguments.length===4){
  const args=n.arguments.slice(0,method==='addPane'?3:2).map(a=>ts.visitNode(a,visit));return ts.factory.updateCallExpression(n,n.expression,n.typeArguments,args);
 }
 if(['changeWorkspace','executeTerminalPreset','saveLayout'].includes(method)&&ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='useCallback'){
  const args=n.arguments.map((arg,index)=>index===1&&ts.isArrayLiteralExpression(arg)?ts.factory.updateArrayLiteralExpression(arg,arg.elements.filter(e=>!(ts.isIdentifier(e)&&e.text==='areaStorage'))):ts.visitNode(arg,visit));return ts.factory.updateCallExpression(n,n.expression,n.typeArguments,args);
 }
 return ts.visitEachChild(n,visit,ctx);
};return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(before),'Default hook AST after explicit area branches and selector arguments removed');
const rpcNodes=s=>{const nodes=[];function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(s)==='api'&&n.expression.name.text==='rpc')nodes.push(shape(n));ts.forEachChild(n,visit);}visit(s);return nodes;};assert.deepEqual(rpcNodes(source),rpcNodes(before));
const previous=JSON.parse(readFileSync('/workspace/scratch/parity-134/compatibility-proof.json','utf8')),byteEqual=previous.byteEqual;for(const p of byteEqual)assert.equal(read(p),old(p),p);
const proof={base,fullAstTraversal:true,lastStatementMutationSmoke:true,wholeDefaultHookAstEqualAfterOnlyExplicitAreaBranchesAndSelectorsRemoved:true,allOriginalRpcCallsDirectAstEqual:rpcNodes(before).length,byteEqual,scope:'Default Workstation root still does not pass paneAreas. New adapter edits only the selected actual area, preserves the other catalog/layout and revalidates the full V3 model. No new build, real window, installer or Actions. Single paired runtime, debounced edits and original right-area UI still pending.'};writeFileSync('/workspace/scratch/parity-135/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({defaultHookAst:true,rpcCalls:proof.allOriginalRpcCallsDirectAstEqual,byteEqual:byteEqual.length}));
