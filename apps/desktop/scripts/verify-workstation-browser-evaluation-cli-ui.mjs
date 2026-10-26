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

export async function verifyWorkstationBrowserEvaluationCliUi(options,{scope,guestRead,readView,workspace,terminalTab}) {
 const {until}=agentUiDriver(options);
 const controls=options.controls.forNamespace?.(scope.d.namespaceId)??options.controls;
 const home=controls.browserNamespaceHome();
 const root=fileURLToPath(new URL("../../../packages/cli/",import.meta.url));
 const cliHome=join(options.output,"browser-evaluation-cli-config");mkdirSync(cliHome,{mode:0o700});
 const environment={...process.env,SUPERSET_HOME_DIR:cliHome};for(const key of ["SUPERSET_API_KEY","SUPERSET_ORGANIZATION_ID","SUPERSET_SANDBOX_WORKSPACE_ID"])delete environment[key];
 const report={source:process.env.GITHUB_SHA,mode:"Original source eval CLI dev runner with explicit namespace and stable operation ID, actual Electron guest; bundled CLI unchanged",calls:[]};
 const save=()=>writeFileSync(join(options.output,"browser-evaluation-cli.json"),JSON.stringify(report,null,2)+"\n");
 const ready=()=>until(async()=>{const description=(await resolveDirectNamespace(home)).description;assert.equal(description.namespaceId,scope.d.namespaceId);assert.equal(description.backendId,scope.d.backendId);return description.capabilities.workstationBrowserEvaluationV1===true;},"source eval CLI peer ready");
 async function run(command,flags,succeeds=true){
  const argv=["../cli-framework/src/bin.ts","dev","browser",command,"--namespace",home,...flags,"--json"];let result;
  try{result={...await execute("bun",argv,{cwd:root,env:environment,maxBuffer:1024*1024}),code:0};}catch(error){result={stdout:error.stdout,stderr:error.stderr,code:error.code};}
  report.calls.push({command,flags,...result});save();
  if(succeeds){assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);}assert.notEqual(result.code,0);return result;
 }
 const status=operationId=>run("operation-status",["--operation-id",operationId]);
 const evaluate=(input,succeeds=true)=>run("eval",["--workspace",input.workspaceId,"--pane",input.paneId,"--code",input.code,"--operation-id",input.operationId],succeeds);
 await ready();const pane=workspace(await readView()).panes.find(row=>row.kind==="browser");assert.ok(pane);const browserTab=workspace(await readView()).activePaneTabId;
 const key="__remix_cli_eval_"+randomUUID().replaceAll("-","");
 const code=`(()=>{const key=${JSON.stringify(key)};globalThis[key]=(globalThis[key]??0)+1;return {count:globalThis[key],title:document.title}})()`;
 const input={operationId:randomUUID(),workspaceId:scope.w.workspaceId,paneId:pane.paneId,code};
 const state=()=>guestRead(`({count:globalThis[${JSON.stringify(key)}]??null,title:document.title,href:location.href})`);
 const first=await evaluate(input);assert.equal(first.result.count,1);assert.equal((await state()).count,1);
 const receipt=await status(input.operationId);assert.equal(receipt.status,"completed");assert.equal(receipt.procedure,"browser.evaluateV1");assert.deepEqual(receipt.result,first);
 assert.deepEqual(await evaluate(input),first);assert.equal((await state()).count,1);
 const conflict=await evaluate({...input,code:"globalThis["+JSON.stringify(key)+"]++"},false);assert.match(conflict.stderr,/different input/);assert.match(conflict.stderr,new RegExp(input.operationId));assert.match(conflict.stderr,/operation-status/);
 const foreign=await evaluate({...input,operationId:randomUUID(),workspaceId:randomUUID()},false);assert.match(foreign.stderr,/Browser|pane|workspace/);assert.equal((await state()).count,1);
 for(const [expression,result] of [["0",0],["null",null],["false",false],["void 0",undefined],[JSON.stringify("中文 🙂"),"中文 🙂"]]){
  const value=await evaluate({...input,operationId:randomUUID(),code:expression});assert.deepEqual(value,result===undefined?{}:{result});
  if(result===undefined)report.originalUndefinedJsonOmissionPreserved=!Object.hasOwn(value,"result");
 }
 const failureKey=key+"_failure";
 const failure={...input,operationId:randomUUID(),code:`(()=>{globalThis[${JSON.stringify(failureKey)}]=(globalThis[${JSON.stringify(failureKey)}]??0)+1;throw Error('OWNED-CLI-EVAL-FAILURE')})()`};
 const failed=await evaluate(failure,false);assert.match(failed.stderr,/Browser evaluation failed/);assert.match(failed.stderr,new RegExp(failure.operationId));
 const unresolved=await status(failure.operationId);assert.equal(unresolved.status,"unresolved");
 const repeatedFailure=await evaluate(failure,false);assert.match(repeatedFailure.stderr,/unresolved/);assert.equal(await guestRead(`globalThis[${JSON.stringify(failureKey)}]`),1);
 await options.click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);await until(async()=>workspace(await readView()).activePaneTabId===terminalTab,"terminal foreground before source CLI eval");
 const focus=()=>options.getPage().evaluate("({tag:document.activeElement?.tagName,className:document.activeElement?.className})");
 await until(async()=>{const current=await focus();return current.tag==="TEXTAREA"&&typeof current.className==="string"&&current.className.includes("xterm-helper-textarea");},"terminal input focus settled before background CLI eval");const focusBefore=await focus();
 assert.deepEqual(await evaluate({...input,operationId:randomUUID(),code:"false"}),{result:false});assert.equal(workspace(await readView()).activePaneTabId,terminalTab);assert.deepEqual(await focus(),focusBefore);
 await options.screenshot("browser-evaluation-cli-background-terminal");await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
 const missing=await run("eval",["--workspace",input.workspaceId,"--pane",input.paneId,"--code","0"],false);assert.match(missing.stderr,/requires --operation-id/);
 assert.deepEqual(await status(input.operationId),receipt);
 report.completed={receipt,oneEvaluationForRepeatedId:true,failedEvaluationNotRetried:true,backgroundTabAndFocusPreserved:true};save();
 return {report,async afterReopen(){
  await ready();const before=await state();assert.equal(before.count,null);assert.deepEqual(await status(input.operationId),receipt);assert.deepEqual(await evaluate(input),first);assert.deepEqual(await state(),before);
  report.reopened={persisted:receipt,noReplayOrRetarget:true};save();
 }};
}
