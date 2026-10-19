import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {agentUiDriver} from './verify-workstation-agent-ui-driver.mjs';
import {verifyWorkstationTerminalScriptExecutionUi} from './verify-workstation-terminal-script-execution-ui.mjs';

export async function verifyWorkstationLocalParityUi(options){
 const {getPage,click,output,screenshot,closeReopen,controls}=options;
 const {evaluate,until}=agentUiDriver(options);
 const body=agentUiDriver({...options,rootSelector:'.ws-main-body'});
 const bodyClick=async selector=>{await body.scrollTo(selector);await click(selector);};
 const key=async(key,code)=>{for(const type of ['keyDown','keyUp'])await getPage().call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code});};
 const view=()=>evaluate(`(async()=>{const {snapshot}=await window.directWorkstation.getWorkspaceView();return snapshot?.targets.find(t=>t.connectionId===snapshot.activeConnectionId);})()`);
 const workspace=async()=>{const t=await view();return t?.workspaces.find(w=>w.tabId===t.activeTabId);};
 const attached=async(count)=>until(()=>evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-terminal-id]')];return rows.length===${count}&&rows.every(e=>e.dataset.restoreState==='attached');})()`),'local terminals attached');
 const create=async(tag)=>{
  await click('text:New session');await click('[role=dialog] input');await getPage().call('Input.insertText',{text:`Local ${tag} ${randomUUID()}`});await click('[role=dialog] button[type=submit]');
  await until(()=>evaluate(`!document.querySelector('[role=dialog]')`),'local session created');await screenshot(`local-${tag}-opened`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.ws-workspace-window'))`),true,'local workspace uses original shared window');
 };
 await click('.ws-local-row button:last-child');
 await until(()=>evaluate(`Boolean([...document.querySelectorAll('.ws-heading-actions button')].find(b=>b.textContent.trim()==='New session'&&!b.disabled))`),'local connection');
 await create('A');
 await click('text:New terminal');await attached(1);
 await click('.xterm-screen');await getPage().call('Input.insertText',{text:"i=0; while true; do printf 'LOCAL A heartbeat %s\\n' \"$i\"; i=$((i+1)); sleep 0.2; done"});await key('Enter',13);
 await click('text:Split vertically');await attached(2);
 const a=await view(),aWorkspace=await workspace(),controlA=controls.forNamespace(a.namespaceId);
 const aDescriptor=await evaluate(`window.directWorkstation.refreshFeatures({connectionId:${JSON.stringify(a.connectionId)},generation:1})`);
 const aExecutions=await Promise.all(aWorkspace.panes.map(p=>controlA.inspectPresetTerminal(p.resourceId)));
 await screenshot('local-A-original-split');
 const details=async()=>{await click('[data-slot=sidebar-content] button[aria-label="SSH machines"]');await bodyClick('.ws-local-row button:first-of-type');await bodyClick('.ws-detail-tabs button:last-child');await until(()=>evaluate(`Boolean(document.querySelector('select')?.closest('.ws-local-data'))||Boolean(document.querySelector('.ws-local-data select'))`),'local namespace selector');};
 await details();await bodyClick('input[aria-label="New namespace name"]');await getPage().call('Input.insertText',{text:'Second local namespace 中文'});await bodyClick('.ws-local-data form button[type=submit]');
 await until(()=>evaluate(`document.querySelector('.ws-local-data select')?.options.length===2`),'second namespace created');
 const select=async(which)=>{await bodyClick('.ws-local-data select');await key(which==='first'?'Home':'End',which==='first'?36:35);await key('Enter',13);await until(()=>evaluate(`(async()=>{const e=document.querySelector('.ws-local-data select');if(!e||e.disabled||e.selectedIndex!==${which==='first'?0:1})return false;const rows=await window.directWorkstation.localData.listNamespaces();return rows.find(r=>r.selected)?.id===e.value;})()`),'namespace selection accepted and UI ready');};
 await select('last');await screenshot('local-B-selected-disconnected');
 await bodyClick('.ws-local-data .ws-service-actions button:nth-of-type(2)');
 const started=await until(()=>evaluate(`(()=>{const notice=[...document.querySelectorAll('.ws-notice')].find(e=>e.textContent.trim()==='Completed'),button=document.querySelector('.ws-local-data .ws-service-actions button:nth-of-type(2)');return notice&&button&&!button.disabled&&{selectedId:document.querySelector('.ws-local-data select')?.value,notice:notice.textContent};})()`),'explicit namespace Start completed');
 writeFileSync(join(output,'local-B-start-completed.json'),JSON.stringify(started,null,2)+'\n');
 await bodyClick('.ws-detail-actions button.primary');
 await until(()=>evaluate(`Boolean([...document.querySelectorAll('.ws-heading-actions button')].find(b=>b.textContent.trim()==='New session'&&!b.disabled))`),'namespace B explicitly connected');
 assert.equal(await evaluate(`Boolean(document.querySelector('.ws-workspace-window'))`),false,'namespace B cannot display A workspace');
 await create('B');await click('text:New terminal');await attached(1);
 const b=await view(),bWorkspace=await workspace(),controlB=controls.forNamespace(b.namespaceId),bExecution=await controlB.inspectPresetTerminal(bWorkspace.panes[0].resourceId);
 assert.notEqual(a.namespaceId,b.namespaceId);await screenshot('local-B-independent-workspace');
 await details();await select('first');await bodyClick('.ws-detail-actions button.primary');await attached(2);
 const returned=await workspace();assert.deepEqual(returned,aWorkspace);
 for(let i=0;i<aExecutions.length;i++)assert.equal((await controlA.inspectPresetTerminal(aWorkspace.panes[i].resourceId)).pid,aExecutions[i].pid);
 assert.equal((await controlB.inspectPresetTerminal(bWorkspace.panes[0].resourceId)).pid,bExecution.pid);
 await screenshot('local-A-restored-after-namespace-switch');
 await closeReopen();await attached(2);
 const reopened=await workspace();assert.deepEqual(reopened,aWorkspace);
 const restore=await until(()=>evaluate(`window.directWorkstation.getWorkspaceRestore()`),'local restore descriptor');assert.equal(restore.status,'ready');assert.equal(restore.descriptor.namespaceId,a.namespaceId);assert.equal(restore.descriptor.instanceId,aDescriptor.instanceId,'restore retains the actual local backend instance');
 for(let i=0;i<aExecutions.length;i++)assert.equal((await controlA.inspectPresetTerminal(aWorkspace.panes[i].resourceId)).pid,aExecutions[i].pid);
 await screenshot('local-A-reopened-original-executions');
 writeFileSync(join(output,'local-parity-acceptance.json'),JSON.stringify({a,aDescriptor,aExecutions,b,bExecution,returned,reopened,restore,errors:getPage().errors},null,2)+'\n');
 if(process.argv.includes('--preset-run')) {
  const {verifyWorkstationPresetRunUi}=await import('./verify-workstation-preset-run-ui.mjs');
  await verifyWorkstationPresetRunUi({...options,controls:controlA});
 } else if(process.argv.includes('--terminal-script-triggers')) {
  const {verifyWorkstationTerminalScriptTriggersUi}=await import('./verify-workstation-terminal-script-triggers-ui.mjs');
  await verifyWorkstationTerminalScriptTriggersUi({...options,controls:controlA});
 } else await verifyWorkstationTerminalScriptExecutionUi({...options,controls:controlA});
 const retainedB=await controlB.inspectPresetTerminal(bWorkspace.panes[0].resourceId);assert.equal(retainedB.pid,bExecution.pid);assert.equal(retainedB.executionId,bExecution.executionId);
 writeFileSync(join(output,'local-parity-final.json'),JSON.stringify({retainedB,errors:getPage().errors},null,2)+'\n');
 assert.deepEqual(getPage().errors,[]);
}
