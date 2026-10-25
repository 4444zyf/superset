import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/workspace/superset/',base='5cbbcf7e23869592293a2b541e7392c0c5b09f3d';
const printer=ts.createPrinter({removeComments:true});
const ast=(s)=>ts.createSourceFile('file.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const old=p=>ast(execFileSync('git',['show',`${base}:${p}`],{cwd:root,encoding:'utf8'}));
const cur=p=>ast(readFileSync(root+p,'utf8'));
function find(tree,predicate){let found;function walk(n){if(predicate(n))found=n;ts.forEachChild(n,walk);}walk(tree);assert.ok(found);return found;}
const print=(n)=>{const children=[];ts.forEachChild(n,child=>{children.push(print(child));});return JSON.stringify([n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children]);};
const shared=cur('apps/desktop/src/shared/browser-link-policy.ts');
const schema=old('apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema.ts');
const names=['linkActionSchema','linkTierMapSchema','DEFAULT_URL_LINKS','DEFAULT_PORT_OPEN_ACTION'];
for(const name of names){const decl=t=>find(t,n=>ts.isVariableDeclaration(n)&&n.name.getText(t)===name);assert.equal(print(decl(schema).initializer,schema),print(decl(shared).initializer,shared),name);}
const path='apps/desktop/src/renderer/workstation/Workstation/hooks/useWorkstationPreferences/preference-client.ts';
const a=old(path),b=cur(path);const oldclass=find(a,n=>ts.isClassDeclaration(n)&&n.name?.text==='PreferenceClient'),newclass=find(b,n=>ts.isClassDeclaration(n)&&n.name?.text==='RevisionedPreferenceClient');
const methods=[];
for(const member of oldclass.members){if(!member.name)continue;const name=member.name.getText(a);const body=member.body??member.initializer?.body??member.initializer;if(!body)continue;const replacement=newclass.members.find(n=>n.name?.getText(b)===name);assert.ok(replacement,name);assert.equal(print(body,a),print(replacement.body??replacement.initializer?.body??replacement.initializer,b),name);methods.push(name);}
const rootPath='apps/desktop/src/renderer/workstation/Workstation/Workstation.tsx';
const rootBefore=old(rootPath),rootAfter=cur(rootPath);
const declaration=(tree,name)=>find(tree,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)===name);
assert.equal(print(declaration(rootBefore,'openPort').initializer.body),print(declaration(rootAfter,'openPortExternal').initializer.body),'original external port open body');
writeFileSync('/workspace/scratch/parity-80/extraction-proof.json',JSON.stringify({base,identicalSchemaInitializers:names,identicalClientBodies:methods,identicalExternalPortOpenBody:true},null,2)+'\n');
console.log('Original schemas and preference client bodies unchanged');
