import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";
export async function verifyWorkstationAgentCatalogChoicesUi({getPage,click,screenshot,closeReopen,controls,output}) {
 const {root,evaluate,until,scrollTo,scrollText,replace,select,menu,closeEditor}=agentUiDriver({getPage,click,screenshot,output});
 const scope=await evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const features=await window.directWorkstation.refreshFeatures(d);const {snapshot}=await window.directWorkstation.getWorkspaceView();const target=snapshot.targets.find(t=>t.connectionId===d.connectionId);return {connectionId:d.connectionId,backendId:d.backendId,namespaceId:d.namespaceId,v2:features.capabilities?.workstationAgentCatalogV2===true,workspaceId:target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId};})()`);
 const query=(path,input)=>evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(!d||d.connectionId!==${JSON.stringify(scope.connectionId)}||d.backendId!==${JSON.stringify(scope.backendId)}||d.namespaceId!==${JSON.stringify(scope.namespaceId)})throw new Error('Agent catalog target changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`);
 const path=scope.v2?'settings.agentConfigs.catalogWithRevisionV2':'settings.agentConfigs.catalogWithRevisionV1';const catalog=()=>query(path);
 const workspace=await query('workspace.get',{id:scope.workspaceId});const original=await controls.verifyWorktreeLocation(workspace.worktreePath);
 const initial=await catalog();const first=initial.configs.find(c=>c.presetId==='claude');assert.ok(first&&first.forkArgs.length>0);
 await click('button[aria-label="Agent settings"]');await select(first.id);
 await replace(`${root} input[id="${first.id}-fork-args"]`,'');await scrollTo(`${root} h2`);await click(`${root} h2`);
 await until(()=>evaluate(`document.querySelector('${root}')?.textContent.includes('Saved')&&!document.querySelector('${root} fieldset:disabled input[aria-label="Label"]')`),'cleared fork save acknowledged');
 const afterClear=await catalog();const actual=await query('settings.agentConfigs.getWithRevisionV1',{id:first.id});
 writeFileSync(join(output,'agent-catalog-cleared-fork-readback.json'),JSON.stringify({sourceRevision:process.env.GITHUB_SHA,capabilityV2:scope.v2,procedure:path,original:first,afterClear:afterClear.configs.find(c=>c.id===first.id),actual},null,2)+'\n');
 await scrollTo(`${root} input[id="${first.id}-fork-args"]`);await screenshot('agent-catalog-cleared-fork-readback');assert.deepEqual(actual.config.forkArgs,[]);assert.deepEqual(afterClear.configs.find(c=>c.id===first.id)?.forkArgs,[]);
 await closeEditor();await closeReopen();
 const ready=()=>until(()=>evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return Boolean(d&&d.connectionId===${JSON.stringify(scope.connectionId)}&&document.querySelector('[data-workstation-presets] button[aria-label="Agent settings"]:not(:disabled)'));})()`),'restored authenticated catalog');
 await ready();assert.deepEqual((await query('settings.agentConfigs.getWithRevisionV1',{id:first.id})).config.forkArgs,[]);
 await click('button[aria-label="Agent settings"]');await until(()=>evaluate(`Boolean(document.querySelector('${root}'))`),'catalog reopened');
 const deleted=[];let current=await catalog();
 while(current.configs.length){
  const row=current.configs[0];await select(row.id);await scrollText('Delete agent');await click('text:Delete agent');await until(()=>evaluate(`Boolean(document.querySelector('[role=alertdialog]'))`),'reviewed deletion');await click('text:Delete');
  current=await until(async()=>{const value=await catalog();return !value.configs.some(c=>c.id===row.id)&&value;},'reviewed row removed');
  await until(()=>evaluate(`!document.querySelector('[role=alertdialog]')`),'delete confirmation closed');deleted.push(row.id);
 }
 assert.equal(deleted.length,initial.configs.length);await until(()=>evaluate(`document.querySelector('${root}')?.textContent.includes('No agents yet')`),'original empty state');await screenshot('agent-catalog-all-original-configs-explicitly-removed');
 const empty=await catalog();assert.deepEqual(empty.configs,[]);await closeEditor();await closeReopen();await ready();assert.deepEqual(await catalog(),empty);assert.deepEqual(await controls.verifyWorktreeLocation(workspace.worktreePath),original);
 await screenshot('agent-catalog-reopened-without-default-reseeding');
 await click('button[aria-label="Agent settings"]');await until(()=>evaluate(`document.querySelector('${root}')?.textContent.includes('No agents yet')`),'empty manager remains usable');await scrollTo(`${root} button[aria-haspopup="menu"]`);await click(`${root} button[aria-haspopup="menu"]`);await menu('Pi');
 const added=await until(async()=>{const value=await catalog();return value.configs.length===1&&value;},'explicit built-in add after empty catalog');assert.equal(added.configs[0].presetId,'pi');assert.ok(!deleted.includes(added.configs[0].id));
 await screenshot('agent-catalog-original-add-menu-restores-only-one-chosen-agent');await closeEditor();await closeReopen();await ready();assert.deepEqual(await catalog(),added);assert.deepEqual(await controls.verifyWorktreeLocation(workspace.worktreePath),original);assert.deepEqual(getPage().errors,[]);await screenshot('agent-catalog-final-reopen-without-automatic-agent-launch');
 writeFileSync(join(output,'workstation-agent-catalog-choices-ui.json'),JSON.stringify({sourceRevision:process.env.GITHUB_SHA,workspaceId:scope.workspaceId,capabilityV2:scope.v2,clearedForkPersisted:true,deletedIds:deleted,emptyRevision:empty.revision,explicitAdded:added.configs[0],finalRevision:added.revision,originalTerminals:original.terminals,noAutomaticRelaunch:true,vendorAgentVerified:false,macOSVerified:false},null,2)+'\n');
}
