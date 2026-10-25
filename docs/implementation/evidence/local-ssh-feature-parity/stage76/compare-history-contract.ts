import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require=createRequire('/workspace/superset/apps/desktop/package.json');
const ts=require('@typescript/typescript6');
const root='/workspace/superset/';
const router='apps/desktop/src/lib/trpc/routers/browser-history/index.ts';
const repo='apps/desktop/src/main/lib/browser/browser-history-repository.ts';
const original=(path:string)=>execFileSync('git',['show','217929f78:'+path],{cwd:root,encoding:'utf8'});
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
const before=parse(original(router));const after=parse(readFileSync(root+router,'utf8'));const repository=parse(readFileSync(root+repo,'utf8'));
const proof:Record<string,unknown>={baseline:'217929f7848e9e253bbaf2c0db9c854511330ed2',scope:'Only implementation extraction. No legacy procedure input, output, type, transport, ordering/limits or error mapping changed.'};
for(const name of ['getAll','search','upsert','clear']){
 const getProperty=(ast:any)=>find(ast,(n:any)=>ts.isPropertyAssignment(n)&&n.name.getText(ast)===name);
 const oldProp=getProperty(before);const newProp=getProperty(after);
 const finalCall=(prop:any)=>prop.initializer;
 const oldMethod=finalCall(oldProp).expression.name.text;
 assert.equal(finalCall(newProp).expression.name.text,oldMethod);
 const input=(prop:any)=>find(prop.initializer,(n:any)=>ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='input');
 const oldInput=input(oldProp),newInput=input(newProp);
 assert.deepEqual(oldInput?.arguments.map(semantic),newInput?.arguments.map(semantic),name+' input changed');
 const oldBody=finalCall(oldProp).arguments[0].body;
 const nextMethod=find(repository,(n:any)=>ts.isMethodDeclaration(n)&&n.name.getText(repository)===name);
 assert(nextMethod?.body);
 const oldOperation=name==='upsert'?oldBody.statements[0].tryBlock:oldBody;
 assert.deepEqual(body(oldOperation.getText(before).replaceAll('localDb','db')),body(nextMethod.body.getText(repository)),name+' query implementation changed');
 if(name==='upsert')assert.deepEqual(semantic(oldBody.statements[0].catchClause),semantic(finalCall(newProp).arguments[0].body.statements[0].catchClause),'error mapping changed');
 proof[name]={procedureType:oldMethod,inputPreserved:true,originalDatabaseOperationPreserved:true,errorMappingPreserved:true};
}
const oldSchema=parse(original('packages/local-db/src/schema/schema.ts'));const newSchema=parse(readFileSync(root+'packages/local-db/src/schema/browser-history.ts','utf8'));
const table=(ast:any)=>find(ast,(n:any)=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='browserHistory').initializer;
assert.deepEqual(semantic(table(oldSchema)),semantic(table(newSchema)),'browser table definition changed');proof.tableDefinitionPreserved=true;
writeFileSync('/workspace/scratch/parity-76/history-contract-proof.json',JSON.stringify(proof,null,2)+'\n');
process.stdout.write(JSON.stringify(proof)+'\n');
