import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {resolveDirectNamespace} from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";
const execute=promisify(execFile);
export async function verifyWorkstationBrowserOpenCliUi(options,{scope,url,readProof,readView,workspace,terminalTab}){
 const {until,rect}=agentUiDriver(options),controls=options.controls.forNamespace?.(scope.d.namespaceId)??options.controls,home=controls.browserNamespaceHome();
 const root=fileURLToPath(new URL("../../../packages/cli/",import.meta.url));
 const cliHome=join(options.output,"browser-open-cli-config");mkdirSync(cliHome,{mode:0o700});
 const environment={...process.env,SUPERSET_HOME_DIR:cliHome};for(const key of ["SUPERSET_API_KEY","SUPERSET_ORGANIZATION_ID","SUPERSET_SANDBOX_WORKSPACE_ID"])delete environment[key];
 const report={source:process.env.GITHUB_SHA,mode:"Original source browser open CLI runner with explicit namespace and stable operation ID into the actual Electron guest; immutable bundled CLI unchanged",calls:[]};
 const save=()=>writeFileSync(join(options.output,"browser-open-cli.json"),JSON.stringify(report,null,2)+"\n");
 const ready=()=>until(async()=>{const description=(await resolveDirectNamespace(home)).description;assert.equal(description.namespaceId,scope.d.namespaceId);assert.equal(description.backendId,scope.d.backendId);return description.capabilities.workstationBrowserOpenV1===true;},"owned open source CLI renderer ready");
 async function run(command,flags,succeeds=true){
  const argv=["../cli-framework/src/bin.ts","dev","browser",command,"--namespace",home,...flags,"--json"];let result;
  try{result={...await execute("bun",argv,{cwd:root,env:environment,maxBuffer:1024*1024}),code:0};}catch(error){result={stdout:error.stdout,stderr:error.stderr,code:error.code};}
  report.calls.push({command,flags,...result});save();
  if(succeeds){assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}assert.notEqual(result.code,0);return result;
 }
 const status=operationId=>run("operation-status",["--operation-id",operationId]);
 const open=(input,succeeds=true)=>run("open",["--workspace",input.workspaceId,"--url",input.url,...(input.operationId?["--operation-id",input.operationId]:[]),...(input.target?["--target",input.target]:[]),...(input.show===undefined?[]:["--show",String(input.show)])],succeeds);
 const rpc=(path,type,input)=>options.getPage().evaluate(`window.directWorkstation.rpc(${JSON.stringify({connectionId:scope.d.connectionId,generation:scope.d.generation,path,type,input})})`);
 const row=(result,id)=>result.snapshot.targets.find(target=>target.connectionId===scope.d.connectionId)?.workspaces.find(item=>item.workspaceId===id);
 const selected=result=>({connection:result.snapshot.activeConnectionId,workspace:result.snapshot.targets.find(target=>target.connectionId===scope.d.connectionId)?.activeTabId,paneTab:workspace(result).activePaneTabId,pane:workspace(result).activePaneId});
 await ready();const original=workspace(await readView()),originalBrowserTab=original.activePaneTabId,originalBrowserIds=original.panes.filter(p=>p.kind==="browser").map(p=>p.paneId);assert.ok(original.tabId);
 const id=randomUUID(),created=await rpc("workspaces.createSession","mutation",{id,operationId:randomUUID(),name:"Owned browser-only CLI "+id.slice(0,6)});assert.equal(created.workspace.id,id);assert.deepEqual(created.terminals,[]);assert.equal(created.workspace.projectId,null);assert.equal(row(await readView(),id),undefined);
 assert.deepEqual((await rpc("terminal.list","query",{workspaceId:id})).sessions,[]);report.setup={workspaceId:id,projectId:created.workspace.projectId,terminals:created.terminals};save();
 await options.click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);await until(async()=>workspace(await readView()).activePaneTabId===terminalTab,"terminal foreground before source CLI open");
 const focus=()=>options.getPage().evaluate("({tag:document.activeElement?.tagName,className:document.activeElement?.className})");await until(async()=>{const value=await focus();return value.tag==="TEXTAREA"&&typeof value.className==="string"&&value.className.includes("xterm-helper-textarea");},"terminal input before source CLI open");
 const before=selected(await readView()),focusBefore=await focus(),firstInput={operationId:randomUUID(),workspaceId:id,url:"about:blank"};
 const first=await open(firstInput);assert.ok(first.paneId);assert.equal(first.url,"about:blank");const firstReceipt=await status(firstInput.operationId);assert.equal(firstReceipt.status,"completed");assert.equal(firstReceipt.procedure,"browser.openV1");assert.deepEqual(firstReceipt.result,first);
 assert.deepEqual(selected(await readView()),before);assert.deepEqual(await focus(),focusBefore);assert.deepEqual(row(await readView(),id).panes.map(p=>p.kind),["browser"]);assert.equal(row(await readView(),id).label,created.workspace.name);assert.deepEqual((await rpc("terminal.list","query",{workspaceId:id})).sessions,[]);
 assert.deepEqual(await open({...firstInput,target:"current-tab",show:false}),first);assert.equal(row(await readView(),id).panes.length,1);
 const conflict=await open({...firstInput,show:true},false);assert.match(conflict.stderr,/different input/);assert.ok(conflict.stderr.includes(firstInput.operationId));assert.match(conflict.stderr,/operation-status/);
 const foreign=await open({...firstInput,operationId:randomUUID(),workspaceId:randomUUID()},false);assert.match(foreign.stderr,/workspace|Workspace/);
 const {operationId:_,...missingId}=firstInput;const missing=await open(missingId,false);assert.match(missing.stderr,/requires --operation-id/);
 assert.deepEqual(selected(await readView()),before);assert.deepEqual(await focus(),focusBefore);await options.screenshot("browser-open-cli-background-terminal");
 const shown=await open({...firstInput,operationId:randomUUID(),target:"new-tab",show:true});await until(async()=>{const value=await readView(),target=value.snapshot.targets.find(t=>t.connectionId===scope.d.connectionId),b=row(value,id);return target.activeTabId===b.tabId&&b.activePaneId===shown.paneId;},"source CLI explicit show selects requested browser workspace");
 assert.equal(row(await readView(),id).panes.length,2);await options.screenshot("browser-open-cli-explicit-show");
 const replaced=await open({...firstInput,operationId:randomUUID()});const changed=row(await readView(),id);assert.equal(changed.panes.length,2);assert.ok(changed.panes.some(p=>p.paneId===first.paneId));assert.ok(!changed.panes.some(p=>p.paneId===shown.paneId));assert.ok(changed.panes.some(p=>p.paneId===replaced.paneId));
 await options.click(`.ws-workspace-tabs [data-tab-id="${original.tabId}"]`);await until(async()=>workspace(await readView()).activePaneTabId===terminalTab,"original terminal remains selected after CLI show");await until(async()=>{const value=await focus();return value.tag==="TEXTAREA"&&typeof value.className==="string"&&value.className.includes("xterm-helper-textarea");},"original terminal input after CLI show");
 const beforeHttp=selected(await readView()),httpFocus=await focus(),httpUrl=new URL("/owned-open-cli?request="+randomUUID(),url).href,httpInput={operationId:randomUUID(),workspaceId:scope.w.workspaceId,url:httpUrl,target:"new-tab",show:false};
 const http=await open(httpInput),httpReceipt=await status(httpInput.operationId);assert.equal(httpReceipt.status,"completed");assert.deepEqual(httpReceipt.result,http);const path=new URL(httpUrl).pathname+new URL(httpUrl).search;
 const count=async()=>(await readProof()).requests.filter(request=>request===path).length;
 await until(async()=>await count()===1,"owned HTTP navigation from source CLI open");assert.equal(workspace(await readView()).panes.find(p=>p.paneId===http.paneId)?.browser.url,httpUrl);assert.deepEqual(selected(await readView()),beforeHttp);assert.deepEqual(await focus(),httpFocus);await options.screenshot("browser-open-cli-http-background-terminal");
 const added=workspace(await readView()).paneTabs.find(tab=>tab.layout.type==="pane"&&tab.layout.paneId===http.paneId);assert.ok(added);
 const closeSelector=`[data-workstation-pane-tabs] [data-tab-id="${added.tabId}"] button[aria-label="Close tab"]`,closePoint=await rect(closeSelector);assert.ok(closePoint);await options.getPage().call("Input.dispatchMouseEvent",{type:"mouseMoved",x:closePoint.x,y:closePoint.y});
 await until(()=>options.getPage().evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(closeSelector)});if(!e)return false;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),style=getComputedStyle(e);return style.pointerEvents==='auto'&&Number(style.opacity)===1&&(hit===e||e.contains(hit));})()`),"original close button revealed by real hover after CLI open");
 await options.click(closeSelector);await until(async()=>!workspace(await readView()).panes.some(p=>p.paneId===http.paneId),"original UI closes only CLI-added HTTP browser tab");await options.click(`[data-workstation-pane-tabs] [data-tab-id="${originalBrowserTab}"]`);assert.deepEqual(workspace(await readView()).panes.filter(p=>p.kind==="browser").map(p=>p.paneId),originalBrowserIds);
 assert.deepEqual((await rpc("terminal.list","query",{workspaceId:id})).sessions,[]);assert.deepEqual(await status(firstInput.operationId),firstReceipt);assert.deepEqual(options.getPage().errors,[]);
 const ids=row(await readView(),id).panes.map(p=>p.paneId).sort();report.completed={first:firstReceipt,http:httpReceipt,projectlessBrowserOnly:true,noTerminalCreated:true,backgroundSelectionAndFocusPreserved:true,explicitShow:true,newTabAndCurrentReplacement:true,defaultEquivalentDeduplication:true,httpRequestCount:await count(),browserIds:ids};save();
 return{report,async afterReopen(){await ready();assert.deepEqual(row(await readView(),id).panes.map(p=>p.paneId).sort(),ids);assert.deepEqual(await status(firstInput.operationId),firstReceipt);assert.deepEqual(await open(firstInput),first);assert.deepEqual(await status(httpInput.operationId),httpReceipt);assert.deepEqual(await open(httpInput),http);assert.deepEqual(row(await readView(),id).panes.map(p=>p.paneId).sort(),ids);assert.ok(!workspace(await readView()).panes.some(p=>p.paneId===http.paneId));assert.equal(await count(),1);assert.deepEqual((await rpc("terminal.list","query",{workspaceId:id})).sessions,[]);assert.deepEqual(options.getPage().errors,[]);report.reopened={rendererErrors:options.getPage().errors,noReplayOrRecreation:true,originalReceiptForClosedPane:true,requestCount:await count()};save();}};
}
