import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {promisify} from 'node:util';
import {LocalBackend} from '../../direct-connection/src/local.ts';
import {ownedRestoreControls} from '../../../apps/desktop/scripts/verify-restore-controls.mjs';

const require=createRequire(new URL('../package.json',import.meta.url));
const {createTRPCClient,httpBatchLink}=require('@trpc/client');
const SuperJSON=require('superjson').default;
const run=promisify(execFile);
const arg=name=>{const value=process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);assert.ok(value,'Missing --'+name);return resolve(value);};
const application=arg('application'),output=arg('output'),cli=arg('cli');
const executable=join(application,'node_modules/electron/dist/electron');
assert.equal(process.platform,'linux');assert.ok(process.getuid()>0);assert.ok(existsSync(cli));mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'remix-cli-actual-'));
const legacyHome=join(root,'legacy-config');mkdirSync(legacyHome,{mode:0o700});
const cliEnv={PATH:process.env.PATH,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',SUPERSET_HOME_DIR:legacyHome};
const fixtures=[],runs=[];
async function invoke(label,args,success=true){
 let stdout='',stderr='',exitCode=0;
 try{const result=await run(cli,[...args,'--json'],{env:cliEnv,timeout:20000,maxBuffer:4*1024*1024});stdout=result.stdout;stderr=result.stderr;}
 catch(error){stdout=error.stdout??'';stderr=error.stderr??'';exitCode=typeof error.code==='number'?error.code:-1;}
 writeFileSync(join(output,label+'.stdout'),stdout);writeFileSync(join(output,label+'.stderr'),stderr);
 const record={label,args,exitCode};runs.push(record);writeFileSync(join(output,'cli-runs.json'),JSON.stringify(runs,null,2)+'\n');
 assert.equal(exitCode===0,success,label+': '+stderr);
 return success?JSON.parse(stdout):stderr;
}
function stats(f){
 const db=new DatabaseSync(f.dbPath,{readOnly:true});
 try{return{agents:db.prepare('SELECT COUNT(*) AS count FROM host_agent_configs').get().count,scripts:db.prepare('SELECT COUNT(*) AS count FROM terminal_preset_catalog').get().count,initialized:db.prepare('SELECT agent_catalog_initialized AS value FROM host_settings WHERE id=1').get()?.value??null,terminals:db.prepare('SELECT COUNT(*) AS count FROM terminal_sessions').get().count};}finally{db.close();}
}
async function fixture(label){
 const home=join(root,'Namespace '+label+' 中文');
 const backend=new LocalBackend({dataDir:home,execPath:executable,supervisorPath:join(application,'dist/main/direct-supervisor.js'),hostServicePath:join(application,'dist/main/direct-backend.js'),migrationsFolder:join(application,'dist/resources/host-migrations'),chatMigrationsFolder:join(application,'dist/resources/chat-migrations'),environment:{HOME:root,PATH:process.env.PATH,LANG:'C.UTF-8'}});
 const connection=await backend.connect();
 const identity=JSON.parse(readFileSync(join(home,'identity.json'),'utf8'));
 const dbPath=join(home,'host',identity.namespaceId,'host.db');assert.equal(lstatSync(dbPath).uid,process.getuid());
 const client=createTRPCClient({links:[httpBatchLink({url:connection.url+'/trpc',transformer:SuperJSON,headers:{Authorization:'Bearer '+connection.secret}})]});
 const f={label,home,backend,connection,identity,dbPath,client};fixtures.push(f);return f;
}
function seed(f){
 const projectId=crypto.randomUUID(),workspaceId=crypto.randomUUID(),sessionId=crypto.randomUUID(),agentId=crypto.randomUUID(),scriptId=crypto.randomUUID();
 const repo=join(f.home,'fixture-repo'),standalone=join(f.home,'fixture-session');
 for(const path of [repo,standalone])mkdirSync(path,{mode:0o700});
 const db=new DatabaseSync(f.dbPath);
 const script={id:scriptId,name:'CLI '+f.label+' script',cwd:'',commands:['printf fixture'],projectIds:null,executionMode:'new-tab',tabOrder:0,createdAt:new Date(0).toISOString()};
 try{
  db.prepare('INSERT INTO projects (id,repo_path,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(projectId,repo,'CLI '+f.label+' Project',1,1);
  db.prepare('INSERT INTO workspaces (id,project_id,worktree_path,branch,name,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(workspaceId,projectId,repo,'main','CLI '+f.label+' workspace','local',1,1);
  db.prepare('INSERT INTO workspaces (id,project_id,worktree_path,branch,name,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(sessionId,null,standalone,'main','CLI '+f.label+' standalone','session',1,1);
  db.prepare('INSERT INTO host_agent_configs (id,preset_id,label,command,args_json,prompt_transport,display_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(agentId,'custom','CLI '+f.label+' Agent','/bin/echo','["fixture"]','argv',0,1,1);
  db.prepare('INSERT INTO terminal_preset_catalog (id,presets_json,revision) VALUES (1,?,1)').run(JSON.stringify([script]));
 }finally{db.close();}
 Object.assign(f,{projectId,workspaceId,sessionId,agentId,scriptId,repo});
}
try{
 const a=await fixture('A'),b=await fixture('B');
 const empty=stats(a);
 assert.deepEqual(await invoke('empty-agents',['agents','list','--namespace',a.home]),[]);
 assert.deepEqual(await invoke('empty-scripts',['scripts','list','--namespace',a.home]),[]);
 assert.deepEqual(stats(a),empty,'read-only catalogs do not initialize or seed settings');
 for(const f of [a,b]){
  seed(f);await run('git',['init','--quiet','-b','main',f.repo]);const operationId=crypto.randomUUID();
  const created=await f.client.direct.execute.mutate({operationId,procedure:'terminal.createSession',input:{terminalId:operationId,workspaceId:f.workspaceId}});assert.equal(created.status,'completed');
  f.terminalId=operationId;f.controls=ownedRestoreControls(f.home,{homeDir:f.home,root});f.execution=await f.controls.inspectPresetTerminal(f.terminalId);f.before=stats(f);
  assert.equal((await invoke(f.label+'-agents',['agents','list','--namespace',f.home]))[0].id,f.agentId);
  assert.equal((await invoke(f.label+'-projects',['projects','list','--namespace',f.home]))[0].path,f.repo);
  const workspaces=await invoke(f.label+'-workspaces',['workspaces','list','--namespace',f.home]);assert.equal(workspaces.length,2);assert.ok(workspaces.every(w=>w.id===f.workspaceId||w.id===f.sessionId));
  assert.deepEqual((await invoke(f.label+'-project-filter',['workspaces','list','--namespace',f.home,'--project','cli '+f.label.toLowerCase()+' project'])).map(w=>w.id),[f.workspaceId]);
  assert.deepEqual((await invoke(f.label+'-search-filter',['workspaces','list','--namespace',f.home,'--search','standalone'])).map(w=>w.id),[f.sessionId]);
  assert.deepEqual(await invoke(f.label+'-tag-filter',['workspaces','list','--namespace',f.home,'--tag','absent']),[]);
  assert.equal((await invoke(f.label+'-scripts',['scripts','list','--namespace',f.home]))[0].id,f.scriptId);
  const terminals=await invoke(f.label+'-terminals',['terminals','list','--namespace',f.home,'--workspace',f.workspaceId]);assert.deepEqual(terminals.sessions.map(t=>t.terminalId),[f.terminalId]);
  assert.deepEqual(stats(f),f.before,'listing does not create or modify persisted records');
  const execution=await f.controls.inspectPresetTerminal(f.terminalId);assert.equal(execution.pid,f.execution.pid);assert.equal(execution.executionId,f.execution.executionId);
 }
 assert.equal((await invoke('A-agents-return',['agents','list','--namespace',a.home]))[0].id,a.agentId);
 assert.match(await invoke('legacy-auth',['agents','list','--local'],false),/Not logged in/);
 assert.match(await invoke('conflicting-target',['projects','list','--namespace',a.home,'--host','other'],false),/either --namespace or --host/);
 const missing=join(root,'never-created');await invoke('missing-target',['projects','list','--namespace',missing],false);assert.equal(existsSync(missing),false);
 await a.backend.stop();a.stopped=true;
 assert.match(await invoke('stopped-target',['agents','list','--namespace',a.home],false),/stopped|unavailable/);
 assert.equal((await invoke('B-after-A-stop',['agents','list','--namespace',b.home]))[0].id,b.agentId);
 assert.deepEqual(await promisify((await import('node:fs')).readdir)(legacyHome),[],'namespace commands and legacy auth failure write no account or telemetry state');
 writeFileSync(join(output,'namespace-cli-acceptance.json'),JSON.stringify({sourceRevision:process.env.GITHUB_SHA,mode:'actual compiled Linux CLI and two owned same-machine Unix backends; no GUI or SSH deployment claim',empty,fixtures:fixtures.map(f=>({label:f.label,namespaceId:f.identity.namespaceId,backendId:f.identity.backendId,home:f.home,execution:{id:f.execution.id,executionId:f.execution.executionId,pid:f.execution.pid},records:f.before})),runs,cloudAccountRequired:false,macOSVerified:false},null,2)+'\n');
}finally{
 for(const f of fixtures.reverse()){try{if(!f.stopped)await f.backend.stop();}finally{f.connection.close();}}
 rmSync(root,{recursive:true,force:true});
}
