import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire('/workspace/superset/apps/desktop/package.json');
const ts = require('@typescript/typescript6');
const root='/workspace/superset/';
const base='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/';
const cases=[
 {name:'autocomplete',old:'components/BrowserToolbar/hooks/useUrlAutocomplete/useUrlAutocomplete.ts',next:'components/BrowserToolbar/hooks/useUrlAutocomplete/useUrlAutocompleteCore.ts',before:'useUrlAutocomplete',after:'useUrlAutocompleteCore',rewrite:(s:string)=>s.replace('electronTrpcClient.browserHistory.getAll\n\t\t\t.query()','loadHistory()').replace('}, [isOpen]);','}, [isOpen, loadHistory]);')},
 {name:'toolbar',old:'components/BrowserToolbar/BrowserToolbar.tsx',next:'components/BrowserToolbar/components/BrowserToolbarView/BrowserToolbarView.tsx',before:'BrowserToolbar',after:'BrowserToolbarView',rewrite:(s:string)=>s.replace('const autocomplete = useUrlAutocomplete({','const autocomplete = useUrlAutocompleteCore({\nloadHistory,').replaceAll('browserRuntimeRegistry.getOverlayContainer','registry.getOverlayContainer').replace('[suggestionsOpen, paneId]','[suggestionsOpen, paneId, registry]')},
 {name:'find',old:'components/BrowserFindBar/BrowserFindBar.tsx',next:'components/BrowserFindBar/components/BrowserFindBarView/BrowserFindBarView.tsx',before:'BrowserFindBar',after:'BrowserFindBarView',rewrite:(s:string)=>s.replaceAll('browserRuntimeRegistry.','registry.').replaceAll('}, [paneId]);','}, [paneId, registry]);')},
 {name:'state',old:'hooks/useBrowserState/useBrowserState.ts',next:'hooks/useBrowserState/useBrowserStateCore.ts',before:'useBrowserState',after:'useBrowserStateCore',rewrite:(s:string)=>s.replaceAll('browserRuntimeRegistry.','registry.').replaceAll('[paneId]','[paneId, registry]')},
 {name:'display-url',old:'components/BrowserToolbar/BrowserToolbar.tsx',next:'components/BrowserToolbar/components/BrowserToolbarView/BrowserToolbarView.tsx',before:'displayUrl',after:'displayUrl',rewrite:(s:string)=>s},
];
function body(path:string,text:string,name:string){
 const ast=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const node=ast.statements.find((s:any)=>ts.isFunctionDeclaration(s)&&s.name?.text===name);
 assert(node?.body,`Missing function ${name}`);return node.body.getText(ast);
}
function semantic(text:string){
 const ast=ts.createSourceFile('body.tsx','function compare() '+text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 assert.equal(ast.parseDiagnostics.length,0);
 function value(node:any):unknown {
  const children:unknown[]=[];ts.forEachChild(node,(child:any)=>{children.push(value(child));});
  const text=ts.isIdentifier(node)||ts.isStringLiteralLike(node)||ts.isNumericLiteral(node)||ts.isJsxText(node)?node.text:undefined;
  return [node.kind, text, children];
 }
 return value(ast.statements[0].body);
}
const proof:Record<string,unknown>={baseline:'2be16ac12d78c4b5d9338e63d55c4fbd2c5d95fe',scope:'Pure extraction; only injected dependency references and their effect dependencies differ. No workstation browser UI enabled.'};
for(const c of cases){
 const old=execFileSync('git',['show','2be16ac12:'+base+c.old],{cwd:root,encoding:'utf8'});
 const next=readFileSync(root+base+c.next,'utf8');
 const expected=semantic(c.rewrite(body(c.old,old,c.before)));
 const actual=semantic(body(c.next,next,c.after));
 assert.deepEqual(actual,expected,c.name+' implementation changed beyond declared injection');
 proof[c.name]={bodyEquivalentAfterDeclaredInjection:true};
}
writeFileSync('/workspace/scratch/parity-75/extraction-body-proof.json',JSON.stringify(proof,null,2)+'\n');
process.stdout.write(JSON.stringify(proof)+'\n');
