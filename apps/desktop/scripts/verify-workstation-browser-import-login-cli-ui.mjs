import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {resolveDirectNamespace} from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";
const execute=promisify(execFile);
export async function verifyWorkstationBrowserImportLoginCliUi(options,{scope,readView,workspace,terminalTab,cookieImportApi}){
 assert.equal(process.platform,"linux");assert.ok(cookieImportApi?.report.completed);
 const {until}=agentUiDriver(options),controls=options.controls.forNamespace?.(scope.d.namespaceId)??options.controls,home=controls.browserNamespaceHome(),root=fileURLToPath(new URL("../../../packages/cli/",import.meta.url));
 const cliHome=join(options.output,"browser-import-login-cli-config");mkdirSync(cliHome,{mode:0o700});
 const environment={...process.env,SUPERSET_HOME_DIR:cliHome};for(const key of ["SUPERSET_API_KEY","SUPERSET_ORGANIZATION_ID","SUPERSET_SANDBOX_WORKSPACE_ID"])delete environment[key];
 const fixture=JSON.parse(readFileSync(join(options.output,"..","import-fixture.json"),"utf8")),profile=fixture.defaultId,files=[join(profile,"History"),join(fixture.configRoot,"google-chrome/Local State")],hashes=()=>files.map(path=>({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")}));assert.equal(existsSync(join(profile,"Cookies")),false);
 const first=cookieImportApi.report.completed.first,keyUnavailable=cookieImportApi.report.completed.keyUnavailable,unusedId=randomUUID();
 const report={source:process.env.GITHUB_SHA,mode:"Original source import-login CLI with explicit local or owned SSH namespace and no Superset account; real original Linux empty login list/rejections plus durable API receipt inspection, no positive credential or CLI mutation claim",calls:[]};
 const save=()=>writeFileSync(join(options.output,"browser-import-login-cli.json"),JSON.stringify(report,null,2)+"\n");
 const ready=()=>until(async()=>{const d=(await resolveDirectNamespace(home)).description;assert.equal(d.namespaceId,scope.d.namespaceId);assert.equal(d.backendId,scope.d.backendId);return d.capabilities.workstationBrowserImportSourcesV1===true&&d.capabilities.workstationBrowserCookieImportV1===true;},"original import-login source CLI peer ready");
 async function run(command,flags,{succeeds=true,namespace=true}={}){
  const argv=["../cli-framework/src/bin.ts","dev","browser",command,...(namespace?["--namespace",home]:[]),...flags,"--json"];let result;
  try{result={...await execute("bun",argv,{cwd:root,env:environment,maxBuffer:1024*1024}),code:0};}catch(error){result={stdout:error.stdout,stderr:error.stderr,code:error.code};}
  report.calls.push({command,flags,namespace,...result});save();if(succeeds){assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}assert.notEqual(result.code,0);return result;
 }
 const pane=cookieImportApi.report.calls[0].input.paneId,base=["--workspace",scope.w.workspaceId,"--pane",pane];
 const list=()=>run("import-login",base,{succeeds:false});
 const status=id=>run("operation-status",["--operation-id",id]);
 const selected=async()=>{const v=await readView(),w=workspace(v);return{connection:v.snapshot.activeConnectionId,workspace:v.snapshot.targets.find(t=>t.connectionId===scope.d.connectionId)?.activeTabId,tab:w.activePaneTabId,pane:w.activePaneId,browsers:w.panes.filter(p=>p.kind==="browser").map(p=>({paneId:p.paneId,url:p.browser.url}))};};
 const focus=()=>options.getPage().evaluate("({tag:document.activeElement?.tagName,className:document.activeElement?.className})"),jar=()=>options.getPage().evaluate("window.directWorkstation.browser.siteCookies.getDomains()");
 await ready();const browserTab=workspace(await readView()).activePaneTabId,originalHashes=hashes(),jarBefore=await jar();await options.click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);await until(async()=>workspace(await readView()).activePaneTabId===terminalTab,"terminal selected before source import-login CLI");await until(async()=>{const f=await focus();return f.tag==="TEXTAREA"&&typeof f.className==="string"&&f.className.includes("xterm-helper-textarea");},"terminal input before source import-login CLI");const before=await selected(),focusBefore=await focus();await options.screenshot("browser-import-login-cli-terminal-before");
 assert.match((await list()).stderr,/No Chromium browsers found to import from/);
 assert.match((await run("import-login",[...base,"--from","Chrome","--operation-id",unusedId],{succeeds:false})).stderr,/No Chromium browsers found to import from/);
 assert.match((await run("import-login",[...base,"--from","Chrome"],{succeeds:false})).stderr,/requires --operation-id/);
 assert.match((await run("import-login",[...base,"--from","Chrome","--operation-id","not-a-uuid"],{succeeds:false})).stderr,/Invalid UUID/);
 assert.match((await run("import-login",[...base,"--host","foreign-host"],{succeeds:false})).stderr,/not both/);
 assert.match((await run("import-login",[...base,"--operation-id",unusedId],{succeeds:false,namespace:false})).stderr,/Not logged in/);
 assert.equal(await status(unusedId),null);assert.deepEqual(await status(first.operationId),first);assert.deepEqual(await status(keyUnavailable.operationId),keyUnavailable);
 assert.deepEqual(await selected(),before);assert.deepEqual(await focus(),focusBefore);assert.deepEqual(hashes(),originalHashes);assert.deepEqual(await jar(),jarBefore);assert.equal(existsSync(join(profile,"Cookies")),false);assert.deepEqual(options.getPage().errors,[]);await options.screenshot("browser-import-login-cli-background-terminal");await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
 report.completed={originalLinuxEmptyLoginList:true,noAccountFallback:true,noMutationForMissingSource:true,unusedOperationId:unusedId,firstReceipt:first,keyUnavailableReceipt:keyUnavailable,sourceFilesUnchanged:originalHashes,jarUnchanged:true,backgroundSelectionAndFocusPreserved:true,rendererErrors:options.getPage().errors};save();
 return{report,async afterReopen(){await ready();const before=await selected(),focusBefore=await focus();assert.match((await list()).stderr,/No Chromium browsers found to import from/);assert.deepEqual(await status(first.operationId),first);assert.deepEqual(await status(keyUnavailable.operationId),keyUnavailable);assert.deepEqual(await selected(),before);assert.deepEqual(await focus(),focusBefore);assert.deepEqual(hashes(),originalHashes);assert.deepEqual(await jar(),jarBefore);assert.equal(existsSync(join(profile,"Cookies")),false);assert.deepEqual(options.getPage().errors,[]);await options.screenshot("browser-import-login-cli-reopened");report.reopened={originalLinuxEmptyLoginList:true,sameOriginalReceipts:true,noReimport:true,sourceFilesUnchanged:hashes(),jarUnchanged:true,selectionAndFocusPreserved:true,rendererErrors:options.getPage().errors};save();}};
}
