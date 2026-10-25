import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root='/workspace/superset/',base='acb55e90ec36ae72c387be4e382a221f7aa07bc3',router='apps/desktop/src/lib/trpc/routers/browser-history/index.ts',repository='apps/desktop/src/main/lib/browser/browser-history-repository.ts',parse=s=>ts.createSourceFile('source.ts',s,ts.ScriptTarget.Latest,true),old=p=>parse(execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'})),cur=p=>parse(readFileSync(root+p,'utf8'));
function find(t,p){let r;function visit(n){if(p(n))r=n;ts.forEachChild(n,visit);}visit(t);assert.ok(r);return r;}
const call=(t,name)=>find(t,n=>ts.isCallExpression(n)&&n.expression.getText()===name),transaction=call(cur(repository),'db.transaction');
function shape(n){
 if(ts.isCallExpression(n)&&n.expression.getText()==='history.importEntries')return shape(transaction);
 if(ts.isIdentifier(n)&&['db','localDb'].includes(n.text))return ['db'];
 if(ts.isStringLiteral(n))return ['string',n.text];
 const children=[];ts.forEachChild(n,x=>children.push(shape(x)));return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,children];
}
assert.deepEqual(shape(call(old(router),'localDb.transaction')),shape(transaction));
const factory=(t,name)=>find(t,n=>ts.isVariableDeclaration(n)&&n.name.getText()===name).initializer;
assert.deepEqual(shape(factory(old(router),'createBrowserHistoryRouter')),shape(factory(cur(router),'createBrowserHistoryRouter')));
const methods=['getAll','search','upsert','clear'];for(const name of methods){const method=t=>find(t,n=>ts.isMethodDeclaration(n)&&n.name?.getText()===name).body;assert.deepEqual(shape(method(old(repository))),shape(method(cur(repository))));}
const chunk=t=>find(t,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='IMPORT_CHUNK_SIZE').initializer.getText();assert.equal(chunk(old(router)),'200');assert.equal(chunk(cur(repository)),'200');
const unchangedFiles={};for(const p of ['apps/desktop/src/shared/workstation-browser.ts','apps/desktop/src/preload/index.ts','packages/local-db/drizzle/0026_browser_history.sql','apps/desktop/src/main/lib/browser/chrome-history-import.ts','apps/desktop/src/main/lib/browser/chromium-profiles.ts','apps/desktop/src/main/lib/browser/chrome-cookie-import.ts']){const b=readFileSync(root+p);assert.deepEqual(b,execFileSync('git',['show',base+':'+p],{cwd:root}));unchangedFiles[p]=createHash('sha256').update(b).digest('hex');}
const result={base,originalTransactionAstMatches:true,chunkSize:200,originalRouterAstMatchesAfterInlinedRepositoryCall:true,existingRepositoryMethodsUnchanged:methods,unchangedFiles,publicInputOutputErrorsAndProcedureTypesPreserved:true,newPrivateIpcOrUi:false,sharedDatabaseMigration:false,nativeVerificationThisStage:false};writeFileSync('/workspace/scratch/parity-87/extraction-proof.json',JSON.stringify(result,null,2)+'\n');console.log('Original import transaction, 200-row chunk size, complete released router semantics and existing history methods preserved');
