import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require=createRequire('/workspace/superset/apps/desktop/package.json');
const ts=require('@typescript/typescript6');
const root='/workspace/superset/';
const original=(path:string)=>execFileSync('git',['show','c36853cc:'+path],{cwd:root,encoding:'utf8'});
const parse=(text:string)=>ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true);
function find(node:any,predicate:(n:any)=>boolean):any {
 if(predicate(node))return node;
 let found:any;ts.forEachChild(node,(child:any)=>{if(!found)found=find(child,predicate);});return found;
}
function semantic(node:any):unknown {
 const children:unknown[]=[];ts.forEachChild(node,(child:any)=>{children.push(semantic(child));});
 const text=ts.isIdentifier(node)||ts.isStringLiteralLike(node)||ts.isNumericLiteral(node)?node.text:undefined;
 return [node.kind,text,children];
}
function body(text:string){return semantic(parse('function compare()'+text).statements[0].body);}
const path='apps/desktop/src/shared/workspace-view.ts';
const baseline=parse(original(path));const current=parse(readFileSync(root+path,'utf8'));
const fn=(ast:any,name:string)=>find(ast,(n:any)=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const oldBody=fn(baseline,'validateWorkspaceView').body.getText(baseline).replace('workspaceViewInputSchema.parse(input)','schema.parse(input)');
const newBody=fn(current,'validateWorkspaceViewWithSchema').body.getText(current);
assert.deepEqual(body(oldBody),body(newBody));
const proof={baseline:'c36853cc07a72c46f8c8b8ab8b32af4daba85d94',originalValidationBodyPreserved:true,onlySubstitution:'workspaceViewInputSchema.parse(input) -> schema.parse(input)',legacyWrapperCallsOriginalSchema:true};
assert(fn(current,'validateWorkspaceView').body.getText(current).includes('validateWorkspaceViewWithSchema(value, workspaceViewInputSchema)'));
writeFileSync('/workspace/scratch/parity-77/validator-contract-proof.json',JSON.stringify(proof,null,2)+'\n');process.stdout.write(JSON.stringify(proof)+'\n');
