import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {agentUiDriver} from './verify-workstation-agent-ui-driver.mjs';

export async function verifyWorkstationLinkedAgentSettingsUi({getPage,click,screenshot,closeReopen,controls,output}) {
 const editor='[data-terminal-preset-editor]',list='[data-workstation-terminal-scripts]',agentRoot='[data-workstation-agent-settings]';
 const script=agentUiDriver({getPage,click,screenshot,output,rootSelector:editor});
 const listing=agentUiDriver({getPage,click,screenshot,output,rootSelector:list});
 const agent=agentUiDriver({getPage,click,screenshot,output,rootSelector:agentRoot});
 const {evaluate,until}=script;
 const scope=await evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const target=snapshot.targets.find(t=>t.connectionId===d.connectionId);return {connectionId:d.connectionId,backendId:d.backendId,namespaceId:d.namespaceId,workspaceId:target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId};})()`);
 const query=(path,input)=>evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(!d||d.connectionId!==${JSON.stringify(scope.connectionId)}||d.backendId!==${JSON.stringify(scope.backendId)}||d.namespaceId!==${JSON.stringify(scope.namespaceId)})throw new Error('Linked agent target changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`);
 const catalog=()=>query('settings.terminalPresets.catalogWithRevisionV1');
 const initial=await until(async()=>{const c=await catalog();return c.initialized&&c;},'script catalog ready');
 const agents=(await query('settings.agentConfigs.catalogWithRevisionV2')).configs;
 const linked=agents.slice(1).map(config=>({config,preset:initial.presets.find(p=>p.agentId===config.id||p.agentId===config.presetId)})).find(entry=>entry.preset);
 assert.ok(linked,'A reviewed non-first linked agent exists');
 const {config,preset}=linked;
 const snapshot=()=>query('settings.agentConfigs.getWithRevisionV1',{id:config.id});
 const firstBefore=await query('settings.agentConfigs.getWithRevisionV1',{id:agents[0].id});
 const before=await snapshot();
 const workspace=await query('workspace.get',{id:scope.workspaceId});
 const originalIds=await evaluate(`(async()=>{const {snapshot}=await window.directWorkstation.getWorkspaceView();return snapshot.targets.find(t=>t.connectionId===${JSON.stringify(scope.connectionId)}).workspaces.find(w=>w.workspaceId===${JSON.stringify(scope.workspaceId)}).panes.map(p=>p.resourceId);})()`);
 assert.ok(originalIds.length>0);
 const inspectOriginals=async()=>({terminals:await Promise.all(originalIds.map(async id=>{const row=await controls.inspectPresetTerminal(id);assert.equal(row.alive,true);assert.equal(row.cwd,workspace.worktreePath);return {id:row.id,executionId:row.executionId,pid:row.pid,cwd:row.cwd};}))});
 const original=await inspectOriginals();
 const openScript=async()=>{
  await click('[data-workstation-presets] button[aria-label="Terminal Scripts"]');
  await until(()=>evaluate(`Boolean(document.querySelector('${list}'))`),'original script list open');
  const selector=`${list} [data-terminal-preset-id="${preset.id}"]`;
  await listing.scrollTo(selector);await click(selector);
  await until(()=>evaluate(`Boolean(document.querySelector('${editor} #preset-directory'))`),'linked script editor open');
 };
 const openAgent=async()=>{
  const present=await evaluate(`Boolean([...document.querySelectorAll('${editor} button')].find(e=>e.textContent.trim()==='Agent settings'))`);
  writeFileSync(join(output,'linked-agent-entry.json'),JSON.stringify({scope,agentId:config.id,presetId:preset.id,firstAgentId:agents[0].id,present},null,2)+'\n');
  await screenshot('linked-agent-settings-entry');assert.equal(present,true,'original linked Agent settings entry is available');
  await script.scrollText('Agent settings');await click('text:Agent settings');
  await until(()=>evaluate(`Boolean(document.querySelector('${agentRoot} input[id="${config.id}-command"]'))`),'exact linked agent editor open');
  assert.equal(await evaluate(`Boolean(document.querySelector('${agentRoot} input[id="${agents[0].id}-command"]'))`),false);
 };
 const closeScript=async()=>{
  await script.scrollText('Done');await click('text:Done');await until(()=>evaluate(`!document.querySelector('${editor}')`),'script editor closed');
  await listing.scrollTo(`${list} [data-slot=dialog-close]`);await click(`${list} [data-slot=dialog-close]`);await until(()=>evaluate(`!document.querySelector('${list}')`),'script list closed');
 };
 await openScript();await openAgent();
 const label='Linked settings 中文 🙂';
 await agent.replace(`${agentRoot} input[aria-label="Label"]`,label);
 await agent.scrollTo(`${agentRoot} h2`);await click(`${agentRoot} h2`);
 const updated=await until(async()=>{const row=await snapshot();return row.config.label===label&&row;},'linked config saved');
 assert.deepEqual(updated.config,{...before.config,label});
 assert.deepEqual(await query('settings.agentConfigs.getWithRevisionV1',{id:agents[0].id}),firstBefore);
 assert.deepEqual(await catalog(),initial);
 await screenshot('linked-agent-original-editor-saved');
 await agent.closeEditor();
 assert.equal(await evaluate(`document.querySelector('${editor} #preset-directory')?.value`),preset.cwd);
 await screenshot('linked-agent-return-preserves-script');await closeScript();
 await closeReopen();
 await until(()=>evaluate(`Boolean(document.querySelector('[data-workstation-presets] button[aria-label="Terminal Scripts"]:not(:disabled)'))`),'linked scripts restored');
 await openScript();await openAgent();
 await until(()=>evaluate(`document.querySelector('${agentRoot} input[aria-label="Label"]')?.value===${JSON.stringify(label)}`),'linked choice and config restored');
 await screenshot('linked-agent-reopen-exact-target');await agent.closeEditor();await closeScript();
 assert.deepEqual(await catalog(),initial);
 assert.deepEqual(await inspectOriginals(),original);
 assert.deepEqual(getPage().errors,[]);
 writeFileSync(join(output,'linked-agent-settings-ui.json'),JSON.stringify({sourceRevision:process.env.GITHUB_SHA,scope,agentId:config.id,presetId:preset.id,firstAgentId:agents[0].id,label,revision:updated.revision,originalTerminals:original.terminals,exactTarget:true,originalEditor:true,scriptCatalogUnchanged:true,reopenVerified:true,noAgentLaunch:true,unsavedScriptNativeVerified:false,macOSVerified:false},null,2)+'\n');
}
