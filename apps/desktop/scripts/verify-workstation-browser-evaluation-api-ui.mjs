import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {resolveDirectNamespace} from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationBrowserEvaluationApiUi(options,{scope,guestRead,readView,workspace,terminalTab}) {
 const {until}=agentUiDriver(options);
 const controls=options.controls.forNamespace?.(scope.d.namespaceId)??options.controls;
 const report={source:process.env.GITHUB_SHA,mode:"Actual protected durable evaluation API through the owned Unix endpoint and original scoped Electron manager; no eval CLI claim",calls:[]};
 const save=()=>writeFileSync(join(options.output,"browser-evaluation-api.json"),JSON.stringify(report,null,2)+"\n");
 const ready=()=>until(async()=>{
  const description=(await resolveDirectNamespace(controls.browserNamespaceHome())).description;
  assert.equal(description.namespaceId,scope.d.namespaceId);assert.equal(description.backendId,scope.d.backendId);
  return description.capabilities.workstationBrowserEvaluationV1===true;
 },"owned evaluation API ready");
 const request=async(procedure,input)=>{const result=await controls.browserEvaluationRequest(procedure,input);report.calls.push({procedure,input,...result});save();return result;};
 await ready();
 const pane=workspace(await readView()).panes.find(row=>row.kind==="browser");assert.ok(pane);
 const browserTab=workspace(await readView()).activePaneTabId;
 const key="__remix_owned_eval_"+randomUUID().replaceAll("-","");
 const code=`(()=>{const key=${JSON.stringify(key)};globalThis[key]=(globalThis[key]??0)+1;return {count:globalThis[key],title:document.title,href:location.href}})()`;
 const input={operationId:randomUUID(),workspaceId:scope.w.workspaceId,paneId:pane.paneId,code};
 const first=await request("direct.browserEvaluateV1",input);assert.equal(first.status,200);assert.equal(first.result.status,"completed");assert.equal(first.result.result.result.count,1);
 const state=()=>guestRead(`({count:globalThis[${JSON.stringify(key)}]??null,title:document.title,href:location.href})`);
 assert.equal((await state()).count,1);
 const duplicate=await request("direct.browserEvaluateV1",input);assert.deepEqual(duplicate.result,first.result);assert.equal((await state()).count,1);
 const conflict=await request("direct.browserEvaluateV1",{...input,code:"globalThis["+JSON.stringify(key)+"]++"});assert.equal(conflict.status,409);assert.equal((await state()).count,1);
 const foreign=await request("direct.browserEvaluateV1",{...input,operationId:randomUUID(),workspaceId:randomUUID()});assert.equal(foreign.status,400);assert.equal((await state()).count,1);
 for(const [expression,expected] of [["0",0],["null",null],["false",false],["void 0",undefined]]){
  const result=await request("direct.browserEvaluateV1",{...input,operationId:randomUUID(),code:expression});assert.equal(result.status,200);assert.equal(result.result.status,"completed");assert.equal(result.result.result.result,expected);
  if(expected===undefined)report.undefinedResultPreserved=Object.hasOwn(result.result.result,"result");
 }
 const failureKey=key+"_failure";
 const failure={...input,operationId:randomUUID(),code:`(()=>{globalThis[${JSON.stringify(failureKey)}]=(globalThis[${JSON.stringify(failureKey)}]??0)+1;throw Error('OWNED-EVALUATION-FAILURE')})()`};
 const failed=await request("direct.browserEvaluateV1",failure);assert.equal(failed.status,400);
 const failedStatus=await request("direct.operationStatus",{operationId:failure.operationId});assert.equal(failedStatus.result.status,"unresolved");
 const repeatedFailure=await request("direct.browserEvaluateV1",failure);assert.equal(repeatedFailure.status,412);assert.equal(await guestRead(`globalThis[${JSON.stringify(failureKey)}]`),1);
 await options.click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);
 await until(async()=>workspace(await readView()).activePaneTabId===terminalTab,"terminal foreground before background evaluation");
 const focus=()=>options.getPage().evaluate("({tag:document.activeElement?.tagName,className:document.activeElement?.className})");const focusBefore=await focus();
 const hidden=await request("direct.browserEvaluateV1",{...input,operationId:randomUUID(),code:"false"});assert.equal(hidden.status,200);assert.equal(hidden.result.result.result,false);
 assert.equal(workspace(await readView()).activePaneTabId,terminalTab);assert.deepEqual(await focus(),focusBefore);
 await options.screenshot("browser-evaluation-background-terminal");
 await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
 const persisted=await request("direct.operationStatus",{operationId:input.operationId});assert.deepEqual(persisted.result,first.result);
 report.completed={first:first.result,oneEvaluationForRepeatedId:true,failedEvaluationNotRetried:true,backgroundTabAndFocusPreserved:true};save();
 return {report,async afterReopen(){
  await ready();const before=await state();assert.equal(before.count,null);
  const persisted=await request("direct.operationStatus",{operationId:input.operationId});assert.deepEqual(persisted.result,first.result);
  const repeated=await request("direct.browserEvaluateV1",input);assert.deepEqual(repeated.result,first.result);assert.deepEqual(await state(),before);
  report.reopened={persisted:persisted.result,noReplayOrRetarget:true};save();
 }};
}
