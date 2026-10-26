import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveDirectNamespace } from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

const execute = promisify(execFile);
export async function verifyWorkstationBrowserNavigationCliUi(options, { scope, url, marker, readProof, guestRead, readView, workspace, terminalTab }) {
    const { until } = agentUiDriver(options);
    const controls = options.controls.forNamespace?.(scope.d.namespaceId) ?? options.controls;
    const home = controls.browserNamespaceHome();
    const root = fileURLToPath(new URL("../../../packages/cli/", import.meta.url));
    const cliHome = join(options.output, "browser-navigation-cli-config");
    mkdirSync(cliHome, {mode:0o700});
    const environment = {...process.env, SUPERSET_HOME_DIR:cliHome};
    for (const key of ["SUPERSET_API_KEY","SUPERSET_ORGANIZATION_ID","SUPERSET_SANDBOX_WORKSPACE_ID"]) delete environment[key];
    const report = {source:process.env.GITHUB_SHA,mode:"Original source CLI dev runner with explicit namespace and operation ID; actual current Electron peer; bundled CLI unchanged",calls:[]};
    const save = () => writeFileSync(join(options.output,"browser-navigation-cli.json"),JSON.stringify(report,null,2)+"\n");
    const ready = () => until(async () => {
        const description = (await resolveDirectNamespace(home)).description;
        assert.equal(description.namespaceId,scope.d.namespaceId);assert.equal(description.backendId,scope.d.backendId);
        return description.capabilities.workstationBrowserNavigationV1 === true && description.capabilities.durableOperations === true;
    },"source CLI navigation peer ready");
    async function run(command, flags, succeeds=true) {
        const argv = ["../cli-framework/src/bin.ts","dev","browser",command,"--namespace",home,...flags,"--json"];
        let result;
        try { result = {...await execute("bun",argv,{cwd:root,env:environment,maxBuffer:1024*1024}),code:0}; }
        catch(error) {result = {stdout:error.stdout,stderr:error.stderr,code:error.code};}
        report.calls.push({command,flags,...result});save();
        if(succeeds) {assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}
        assert.notEqual(result.code,0);return result;
    }
    const status = (operationId) => run("operation-status",["--operation-id",operationId]);
    const navigate = (input,succeeds=true) => run("navigate",["--workspace",input.workspaceId,"--pane",input.paneId,"--url",input.url,"--operation-id",input.operationId],succeeds);
    await ready();
    const pane = workspace(await readView()).panes.find(row=>row.kind==="browser");assert.ok(pane);
    const browserTab=workspace(await readView()).activePaneTabId;
    const target=new URL(url);target.pathname="/cli-owned-navigation";target.search="?request="+randomUUID();target.hash="section";
    const input={operationId:randomUUID(),workspaceId:scope.w.workspaceId,paneId:pane.paneId,url:target.href};
    assert.deepEqual(await navigate(input),{ok:true});
    await until(async ()=>(await guestRead("location.pathname"))===target.pathname,"source CLI navigated the actual guest");
    const canonical=await until(async()=>{const current=workspace(await readView()).panes.find(row=>row.paneId===pane.paneId)?.browser?.url;return current===target.href?current:null;},"CLI canonical URL persisted");
    const count=async()=>(await readProof()).requests.filter(path=>path===target.pathname+target.search).length;
    assert.equal(await count(),1);
    const first=await status(input.operationId);assert.equal(first.status,"completed");assert.equal(first.procedure,"browser.navigateV1");assert.deepEqual(first.result,{ok:true});
    assert.deepEqual(await navigate(input),{ok:true});assert.deepEqual(await status(input.operationId),first);assert.equal(await count(),1);
    const conflict=await navigate({...input,url},false);assert.match(conflict.stderr,/different input/);assert.match(conflict.stderr,new RegExp(input.operationId));assert.match(conflict.stderr,/operation-status/);
    const foreign=await navigate({...input,operationId:randomUUID(),workspaceId:randomUUID()},false);assert.match(foreign.stderr,/pane|workspace|Browser/);
    assert.equal(await guestRead("location.pathname"),target.pathname);
    assert.equal(await status(randomUUID()),null);
    const missing=await run("navigate",["--workspace",input.workspaceId,"--pane",input.paneId,"--url",url],false);assert.match(missing.stderr,/requires --operation-id/);
    await options.click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);
    await until(async()=>workspace(await readView()).activePaneTabId===terminalTab,"terminal foreground before CLI background navigation");
    const focus=()=>options.getPage().evaluate("({tag:document.activeElement?.tagName,className:document.activeElement?.className})");await until(async()=>{const current=await focus();return current.tag==="TEXTAREA"&&typeof current.className==="string"&&current.className.includes("xterm-helper-textarea");},"terminal input focus settled before background browser operation");
    const focusBefore=await focus();
    const hidden={...input,operationId:randomUUID(),url:new URL("/cli-owned-hidden?request="+randomUUID(),url).href};
    assert.deepEqual(await navigate(hidden),{ok:true});assert.equal(workspace(await readView()).activePaneTabId,terminalTab);assert.deepEqual(await focus(),focusBefore);
    await options.screenshot("browser-navigation-cli-background-terminal");
    await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
    await until(async()=>(await guestRead("location.pathname"))==="/cli-owned-hidden","CLI background navigation reached actual guest");
    assert.deepEqual(await navigate({...input,operationId:randomUUID(),url}),{ok:true});
    await until(async()=>(await guestRead("document.body.innerText"))?.includes(marker),"original owned page restored after CLI navigation");
    report.completed={first,canonical,oneRequestForRepeatedId:true,backgroundTabAndFocusPreserved:true};save();
    return {report,async afterReopen(){
        await ready();const before=await guestRead("location.href");
        assert.deepEqual(await status(input.operationId),first);assert.deepEqual(await navigate(input),{ok:true});
        assert.equal(await guestRead("location.href"),before);assert.equal(await count(),1);
        report.reopened={persisted:first,noReplayOrRetarget:true};save();
    }};
}
