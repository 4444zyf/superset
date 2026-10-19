import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createReadStream,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalBackend} from '../../../packages/direct-connection/src/local.ts';
import {ownedRestoreControls} from './verify-restore-controls.mjs';

const require=createRequire(new URL('../../../packages/cli/package.json',import.meta.url));
const {createTRPCClient,httpBatchLink}=require('@trpc/client');
const SuperJSON=require('superjson').default;
const run=promisify(execFile);
const arg=name=>{const value=process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);assert.ok(value,'Missing --'+name);return resolve(value);};
const application=arg('application'),output=arg('output'),cli=arg('cli');
const backendRevision=process.argv.find(value=>value.startsWith('--backend-revision='))?.slice('--backend-revision='.length)??process.env.GITHUB_SHA;
const executable=join(application,'node_modules/electron/dist/electron');
assert.equal(process.platform,'linux');assert.ok(process.getuid()>0);assert.ok(existsSync(cli));mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'remix-cli-actual-'));
const cliHash=createHash('sha256');for await(const chunk of createReadStream(cli))cliHash.update(chunk);const cliSha256=cliHash.digest('hex');
const legacyHome=join(root,'legacy-config');mkdirSync(legacyHome,{mode:0o700});
const cliEnv={PATH:process.env.PATH,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',SUPERSET_HOME_DIR:legacyHome};
const fixtures=[],runs=[];
async function invoke(label,args,success=true,json=true){
 let stdout='',stderr='',exitCode=0;
 try{const result=await run(cli,json?[...args,'--json']:args,{env:cliEnv,timeout:20000,maxBuffer:4*1024*1024});stdout=result.stdout;stderr=result.stderr;}
 catch(error){stdout=error.stdout??'';stderr=error.stderr??'';exitCode=typeof error.code==='number'?error.code:-1;}
 writeFileSync(join(output,label+'.stdout'),stdout);writeFileSync(join(output,label+'.stderr'),stderr);
 const record={label,args,json,exitCode};runs.push(record);writeFileSync(join(output,'cli-runs.json'),JSON.stringify(runs,null,2)+'\n');
 assert.equal(exitCode===0,success,label+': '+stderr);
 return success?(json?JSON.parse(stdout):stdout):stderr;
}
function stats(f){
 const db=new DatabaseSync(f.dbPath,{readOnly:true});
 try{return{agents:db.prepare('SELECT COUNT(*) AS count FROM host_agent_configs').get().count,scripts:db.prepare('SELECT COUNT(*) AS count FROM terminal_preset_catalog').get().count,initialized:db.prepare('SELECT agent_catalog_initialized AS value FROM host_settings WHERE id=1').get()?.value??null,terminals:db.prepare('SELECT COUNT(*) AS count FROM terminal_sessions').get().count};}finally{db.close();}
}
async function fixture(label){
 const home=join(root,'Namespace '+label+' 中文');
 const backend=new LocalBackend({dataDir:home,execPath:executable,supervisorPath:join(application,'dist/main/direct-supervisor.js'),hostServicePath:join(application,'dist/main/direct-backend.js'),migrationsFolder:join(application,'dist/resources/host-migrations'),chatMigrationsFolder:join(application,'dist/resources/chat-migrations'),environment:{HOME:root,PATH:process.env.PATH,LANG:'C.UTF-8'}});
 let connection;
 try{connection=await backend.connect();}catch(error){await backend.stop().catch(()=>{});throw error;}
 const identity=JSON.parse(readFileSync(join(home,'identity.json'),'utf8'));
 const dbPath=join(home,'host',identity.namespaceId,'host.db');assert.equal(lstatSync(dbPath).uid,process.getuid());
 const client=createTRPCClient({links:[httpBatchLink({url:connection.url+'/trpc',transformer:SuperJSON,headers:{Authorization:'Bearer '+connection.secret}})]});
 const f={label,home,backend,connection,identity,dbPath,client};fixtures.push(f);return f;
}
async function waitForScreen(f,marker){
 const deadline=Date.now()+5000;
 for(;;){const screen=await f.client.terminal.snapshot.query({workspaceId:f.workspaceId,terminalId:f.terminalId});if(screen.text.includes(marker))return screen;assert.ok(Date.now()<deadline,'Owned terminal output did not become readable');await delay(50);}
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
 const version=await invoke('cli-version',['--version'],true,false);assert.equal(version.trim(),JSON.parse(readFileSync(join(application,'package.json'),'utf8')).version);
 assert.ok((await invoke('namespace-help',['agents','list','--help'],true,false)).includes('--namespace'));
 const a=await fixture('A'),b=await fixture('B');
 const empty=stats(a);
 assert.deepEqual(await invoke('empty-agents',['agents','list','--namespace',a.home]),[]);
 assert.deepEqual(await invoke('empty-scripts',['scripts','list','--namespace',a.home]),[]);
 assert.deepEqual(stats(a),empty,'read-only catalogs do not initialize or seed settings');
 for(const f of [a,b]){
  seed(f);await run('git',['init','--quiet','-b','main',f.repo]);const operationId=crypto.randomUUID();
  const created=await f.client.direct.execute.mutate({operationId,procedure:'terminal.createSession',input:{terminalId:operationId,workspaceId:f.workspaceId,cols:80,rows:24,initialCommand:`printf '\\033[2J\\033[HCLI ${f.label} normal 输出\\n'`}});assert.equal(created.status,'completed');
  f.terminalId=operationId;f.controls=ownedRestoreControls(f.home,{homeDir:f.home,root});f.execution=await f.controls.inspectPresetTerminal(f.terminalId);f.before=stats(f);
  assert.equal((await invoke(f.label+'-agents',['agents','list','--namespace',f.home]))[0].id,f.agentId);
  assert.equal((await invoke(f.label+'-projects',['projects','list','--namespace',f.home]))[0].path,f.repo);
  const workspaces=await invoke(f.label+'-workspaces',['workspaces','list','--namespace',f.home]);assert.equal(workspaces.length,2);assert.ok(workspaces.every(w=>w.id===f.workspaceId||w.id===f.sessionId));
  assert.deepEqual((await invoke(f.label+'-project-filter',['workspaces','list','--namespace',f.home,'--project','cli '+f.label.toLowerCase()+' project'])).map(w=>w.id),[f.workspaceId]);
  assert.deepEqual((await invoke(f.label+'-search-filter',['workspaces','list','--namespace',f.home,'--search','standalone'])).map(w=>w.id),[f.sessionId]);
  assert.deepEqual(await invoke(f.label+'-tag-filter',['workspaces','list','--namespace',f.home,'--tag','absent']),[]);
  assert.equal((await invoke(f.label+'-scripts',['scripts','list','--namespace',f.home]))[0].id,f.scriptId);
  const terminals=await invoke(f.label+'-terminals',['terminals','list','--namespace',f.home,'--workspace',f.workspaceId]);assert.deepEqual(terminals.sessions.map(t=>t.terminalId),[f.terminalId]);
  await waitForScreen(f,'CLI '+f.label+' normal 输出');
  const readArgs=['terminals','read','--namespace',f.home,'--workspace',f.workspaceId,'--terminal',f.terminalId];
  const normal=await invoke(f.label+'-screen-normal',readArgs);assert.equal(normal.terminalId,f.terminalId);assert.ok(normal.text.includes('CLI '+f.label+' normal 输出'));assert.equal(normal.cols,80);assert.equal(normal.rows,24);
  const capped=await invoke(f.label+'-screen-capped',[...readArgs,'--max-lines','1']);assert.ok(capped.text.split('\n').length<=1);assert.equal(capped.terminalId,f.terminalId);
  await f.client.terminal.send.mutate({workspaceId:f.workspaceId,terminalId:f.terminalId,text:`printf '\\033[?1049h\\033[2J\\033[HCLI ${f.label} TUI 中文\\n'`,submit:true});
  await waitForScreen(f,'CLI '+f.label+' TUI 中文');
  const alternate=await invoke(f.label+'-screen-tui',readArgs);assert.ok(alternate.text.includes('CLI '+f.label+' TUI 中文'));assert.equal(alternate.text.includes('normal 输出'),false);
  assert.ok((await invoke(f.label+'-screen-text',readArgs,true,false)).includes('CLI '+f.label+' TUI 中文'));
  await invoke(f.label+'-screen-wrong-workspace',['terminals','read','--namespace',f.home,'--workspace',f.sessionId,'--terminal',f.terminalId],false);
  await invoke(f.label+'-screen-missing',['terminals','read','--namespace',f.home,'--workspace',f.workspaceId,'--terminal',crypto.randomUUID()],false);
  await invoke(f.label+'-screen-invalid-limit',[...readArgs,'--max-lines','0'],false);
  assert.deepEqual(stats(f),f.before,'listing does not create or modify persisted records');
  const execution=await f.controls.inspectPresetTerminal(f.terminalId);assert.equal(execution.pid,f.execution.pid);assert.equal(execution.executionId,f.execution.executionId);
 }
 await invoke('B-cannot-read-A',['terminals','read','--namespace',b.home,'--workspace',a.workspaceId,'--terminal',a.terminalId],false);
 assert.deepEqual(stats(a),a.before);assert.deepEqual(stats(b),b.before);
 const restarted=await a.controls.restartHost();
 const adopted=await invoke('A-screen-adopted',['terminals','read','--namespace',a.home,'--workspace',a.workspaceId,'--terminal',a.terminalId]);assert.ok(adopted.text.includes('CLI A TUI 中文'));assert.equal(adopted.terminalId,a.terminalId);
 const executionAfterRestart=await a.controls.inspectPresetTerminal(a.terminalId);assert.equal(executionAfterRestart.pid,a.execution.pid);assert.equal(executionAfterRestart.executionId,a.execution.executionId);assert.deepEqual(stats(a),a.before);
 assert.equal((await invoke('A-agents-return',['agents','list','--namespace',a.home]))[0].id,a.agentId);
 assert.match(await invoke('legacy-auth',['agents','list','--local'],false),/Not logged in/);
 assert.match(await invoke('conflicting-target',['projects','list','--namespace',a.home,'--host','other'],false),/either --namespace or --host/);
 assert.match(await invoke('unsupported-write',['scripts','add','--namespace',a.home,'--name','refused','--command','echo refused'],false),/Unknown option: --namespace/);
 const missing=join(root,'never-created');await invoke('missing-target',['projects','list','--namespace',missing],false);assert.equal(existsSync(missing),false);
 await a.backend.stop();a.stopped=true;
 assert.match(await invoke('stopped-target',['agents','list','--namespace',a.home],false),/stopped|unavailable/);
 assert.equal((await invoke('B-after-A-stop',['agents','list','--namespace',b.home]))[0].id,b.agentId);
 assert.deepEqual(await promisify((await import('node:fs')).readdir)(legacyHome),[],'namespace commands and legacy auth failure write no account or telemetry state');
 writeFileSync(join(output,'namespace-cli-acceptance.json'),JSON.stringify({sourceRevision:process.env.GITHUB_SHA,backendSourceRevision:backendRevision,cliSha256,version:version.trim(),mode:'actual compiled Linux CLI and two owned same-machine Unix backends; no GUI or SSH deployment claim',empty,restarted,fixtures:fixtures.map(f=>({label:f.label,namespaceId:f.identity.namespaceId,backendId:f.identity.backendId,home:f.home,execution:{id:f.execution.id,executionId:f.execution.executionId,pid:f.execution.pid},records:f.before})),runs,cloudAccountRequired:false,macOSVerified:false},null,2)+'\n');
}finally{
 const cleanup=await Promise.allSettled(fixtures.map(async f=>{try{if(!f.stopped)await f.backend.stop();}finally{f.connection.close();}}));
 const failed=cleanup.filter(result=>result.status==='rejected');
 if(failed.length){writeFileSync(join(output,'cleanup-error.json'),JSON.stringify({root,errors:failed.map(result=>String(result.reason))},null,2)+'\n');throw new Error('Owned fixture cleanup did not complete; retained its files');}
 rmSync(root,{recursive:true,force:true});
}
