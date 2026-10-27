import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
const root='/workspace/superset/',base='b50652010',before=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),current=p=>readFileSync(root+p,'utf8');const parse=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);function shape(n){const ch=[];ts.forEachChild(n,c=>ch.push(shape(c)));return[n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];}
const path='apps/desktop/src/renderer/workstation/Workstation/providers/WorkstationBrowsers/workstation-browsers.ts',old=parse(before(path)),source=parse(current(path));
const normalized=ts.transform(source,[ctx=>{const visit=n=>{
 if(ts.isInterfaceDeclaration(n)&&n.name.text==='RegistrationWaiter')return undefined;
 if((ts.isPropertySignature(n)||ts.isPropertyAssignment(n))&&['waiters','registrationError'].includes(n.name.getText(source)))return undefined;
 if(ts.isMethodDeclaration(n)&&['finishRegistration','openBackground'].includes(n.name.getText(source)))return undefined;
 if(ts.isMethodDeclaration(n)&&n.name.getText(source)==='destroy')return ts.factory.updateMethodDeclaration(n,n.modifiers,n.asteriskToken,n.name,n.questionToken,n.typeParameters,n.parameters,n.type,ts.visitNode(ts.factory.updateBlock(n.body,n.body.statements.slice(2)),visit));
 if(ts.isExpressionStatement(n)&&/^(this\.finishRegistration\(|runtime\.registrationError\s*=)/.test(n.expression.getText(source)))return undefined;
 if(ts.isIfStatement(n)&&n.thenStatement.getText(source).includes('this.finishRegistration(')&&!n.elseStatement)return undefined;
 if(ts.isTryStatement(n)&&n.catchClause?.getText(source).includes('runtime.registrationError'))return n.tryBlock.statements.map(x=>ts.visitNode(x,visit));
 return ts.visitEachChild(n,visit,ctx);
};return n=>ts.visitNode(n,visit);}]).transformed[0];assert.deepEqual(shape(normalized),shape(old),path);
const untouched=['apps/desktop/src/main/direct-app.ts','apps/desktop/src/preload/index.ts','apps/desktop/src/shared/workstation-browser-open.ts','apps/desktop/src/renderer/workstation/Workstation/Workstation.tsx','apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistryCore.ts','packages/host-service/src/trpc/router/direct/direct.ts','packages/cli/src/commands/browser/open/command.ts'];for(const p of untouched)assert.equal(current(p),before(p),p);
const proof={base,normalizedAstEqual:[path],byteEqual:untouched,limitations:'Public background registration waiter only; Root has no open consumer or readiness handshake. No new build or native UI claim.'};writeFileSync('/workspace/scratch/parity-115/compatibility-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
