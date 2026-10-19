import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";
export async function verifyWorkstationTerminalScriptExecutionUi({getPage,click,screenshot,output,closeReopen,requestClose,controls}){
 const list='[data-workstation-terminal-scripts]',editor='[data-terminal-preset-editor]';
 const driver=agentUiDriver({getPage,click,screenshot,output,rootSelector:editor}),listing=agentUiDriver({getPage,click,screenshot,output,rootSelector:list});
 const {evaluate,until,replace,scrollTo,scrollText}=driver;
 const scope=await evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId);const w=t.workspaces.find(w=>w.tabId===t.activeTabId);return {d,w};})()`);
 const query=(path,input)=>evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.d.connectionId)}||d.backendId!==${JSON.stringify(scope.d.backendId)}||d.namespaceId!==${JSON.stringify(scope.d.namespaceId)})throw new Error('Script target changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`);
 const view=()=>evaluate(`(async()=>{const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===snapshot.activeConnectionId);return t.workspaces.find(w=>w.tabId===t.activeTabId);})()`);
 const catalog=()=>query('settings.terminalPresets.catalogWithRevisionV1');
 const workspace=await query('workspace.get',{id:scope.w.workspaceId});
 const root=workspace.worktreePath,folder=root+'/脚本 目录';
 const key=async(key,code)=>{for(const type of ['keyDown','keyUp'])await getPage().call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code});};
 const text=value=>getPage().call('Input.insertText',{text:value});
 await click('text:New terminal');const setup=await until(async()=>{const w=await view();return w.panes.find(p=>!scope.w.panes.some(old=>old.paneId===p.paneId));},'setup shell created');
 await until(()=>evaluate(`document.querySelector('[data-terminal-id="${setup.resourceId}"]')?.dataset.restoreState==='attached'`),'setup shell attached');
 await click(`[data-terminal-id="${setup.resourceId}"] .xterm-screen`);await text("mkdir -p '脚本 目录'");await key('Enter',13);
 await until(async()=>{try{return (await query('filesystem.getMetadata',{workspaceId:scope.w.workspaceId,absolutePath:folder})).kind==='directory';}catch{return false;}},'Unicode script folder created through shell');
 const open=async()=>{await click('[data-workstation-presets] button[aria-label="Terminal Scripts"]');await until(()=>evaluate(`Boolean(document.querySelector('${list}'))`),'script list');};
 const done=async()=>{await scrollText('Done');await click('text:Done');await until(()=>evaluate(`!document.querySelector('${editor}')`),'script editor closed');};
 const closeList=async()=>{await listing.scrollTo(`${list} [data-slot=dialog-close]`);await click(`${list} [data-slot=dialog-close]`);await until(()=>evaluate(`!document.querySelector('${list}')`),'script list closed');};
 const set=async(selector,value)=>{await replace(selector,value);await scrollTo(`${editor} h2`);await click(`${editor} h2`);};
 const row=async id=>(await catalog()).presets.find(p=>p.id===id);
 await open();await click('text:Add script');await until(()=>evaluate(`Boolean(document.querySelector('${editor} #preset-name'))`),'new script editor');
 const name='Launch tools 中文';await set(`${editor} #preset-name`,name);const preset=await until(async()=>(await catalog()).presets.find(p=>p.name===name),'script persisted');
 await set(`${editor} #preset-directory`,'脚本 目录');
 const command=`${editor} input[placeholder="e.g. bun run dev"]`;
 await set(command,"pwd > preset-cwd.txt && printf 'A new-tab\\n' >> preset-a.txt");await scrollText('Add command');await click('text:Add command');await until(()=>evaluate(`document.querySelectorAll('${command}').length===2`),'second command');await set(`${editor} div[class~="group/command-row"]:nth-child(2) input`,"printf 'B new-tab\\n' >> preset-b.txt");
 const modeLabels={'new-tab':'Each in its own new tab','new-tab-split-pane':'All in a new tab (split panes)','split-pane':'All in current tab (split panes)','sequential':'All in current tab'};
 const setMode=async mode=>{await scrollTo(`${editor} button[role=combobox]`);await click(`${editor} button[role=combobox]`);const selector=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(modeLabels[mode])});return e&&'[data-slot=select-item]:nth-child('+([...e.parentElement.children].indexOf(e)+1)+')';})()`),'mode option');await click(selector);await until(async()=>(await row(preset.id)).executionMode===mode,'launch mode saved');};
 await setMode('new-tab');await done();await closeList();await screenshot('terminal-script-execution-saved-custom-script');
 const button=`[data-workstation-script-id="${preset.id}"] button`;
 assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(button)}))`),true,'saved custom script is present in the original preset bar');
 const read=async file=>{try{const result=await query('filesystem.readFile',{workspaceId:scope.w.workspaceId,absolutePath:folder+'/'+file,maxBytes:65536});return result.kind==='text'?result.content:Buffer.from(result.content,'base64').toString();}catch{return null;}};
 const snapshots=[];
 for(const mode of ['new-tab','new-tab-split-pane','split-pane','sequential']){
  if(mode!=='new-tab'){
   await open();await listing.scrollTo(`${list} [data-terminal-preset-id="${preset.id}"]`);await click(`${list} [data-terminal-preset-id="${preset.id}"]`);await until(()=>evaluate(`Boolean(document.querySelector('${editor} #preset-directory'))`),'edit existing script');
   await set(`${editor} div[class~="group/command-row"]:nth-child(1) input`,"pwd > preset-cwd.txt && printf 'A "+mode+"\\n' >> preset-a.txt");await set(`${editor} div[class~="group/command-row"]:nth-child(2) input`,"printf 'B "+mode+"\\n' >> preset-b.txt");await setMode(mode);await done();await closeList();
  }
  const before=await view();
  if(mode==='sequential'){
   const active=before.panes.find(p=>p.paneId===before.activePaneId);await until(()=>evaluate(`document.querySelector('[data-terminal-id="${active.resourceId}"]')?.dataset.restoreState==='attached'`),'sequential target attached');
   await click(`[data-terminal-id="${active.resourceId}"] .xterm-screen`);await text('cd /tmp');await key('Enter',13);
  }
  await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(button)}+':not(:disabled)'))`),'script launch enabled');await click(button);
  const index=snapshots.length+1;await until(async()=>{const a=await read('preset-a.txt'),b=await read('preset-b.txt');return a?.trim().split('\n').length===index&&b?.trim().split('\n').length===index;},'commands execute exactly once');
  const after=await view();assert.equal(after.panes.length-before.panes.length,mode==='sequential'?0:2);
  assert.equal(after.paneTabs.length-before.paneTabs.length,mode==='new-tab'?2:mode==='new-tab-split-pane'?1:0);
  assert.equal((await read('preset-cwd.txt')).trim(),folder);
  snapshots.push({mode,before,after,a:await read('preset-a.txt'),b:await read('preset-b.txt')});await screenshot('terminal-script-execution-'+mode);
 }
 const last=await view(),pids=await Promise.all(last.panes.map(p=>controls.inspectPresetTerminal(p.resourceId)));
 const contents={a:await read('preset-a.txt'),b:await read('preset-b.txt')};await closeReopen();await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(button)}+':not(:disabled)'))`),'script bar restored');
 assert.equal(await read('preset-a.txt'),contents.a);assert.equal(await read('preset-b.txt'),contents.b);
 const restored=await view();assert.deepEqual(restored.paneTabs,last.paneTabs);for(let i=0;i<pids.length;i++)assert.equal((await controls.inspectPresetTerminal(last.panes[i].resourceId)).pid,pids[i].pid);
 await screenshot('terminal-script-execution-reopen-no-replay');
 let closeWhileLaunching=null;
 if(process.argv.includes('--terminal-script-close-inflight')){
  await open();await listing.scrollTo(`${list} [data-terminal-preset-id="${preset.id}"]`);await click(`${list} [data-terminal-preset-id="${preset.id}"]`);await until(()=>evaluate(`Boolean(document.querySelector('${editor} #preset-directory'))`),'close test script editor');
  await set(`${editor} div[class~="group/command-row"]:nth-child(1) input`,"printf 'A window-close\\n' >> preset-a.txt");await set(`${editor} div[class~="group/command-row"]:nth-child(2) input`,"printf 'B window-close\\n' >> preset-b.txt");await setMode('new-tab');await done();await closeList();
  const paused=controls.pauseOwnedBackend();let alive=false,busy=false;
  try{
   await click(button);busy=await evaluate(`document.querySelector(${JSON.stringify(button)}).disabled`);assert.equal(busy,true,'script launch began before close');
   await requestClose('window');await delay(200);
   try{alive=await evaluate('document.readyState!==undefined');}catch{alive=false;}
   writeFileSync(join(output,'terminal-script-close-held.json'),JSON.stringify({pid:paused.pid,busy,alive},null,2)+'\n');
  }finally{paused.resume();}
  assert.equal(alive,true,'normal window close waits for the requested script launch and saved layout');
  await closeReopen(true);await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(button)}+':not(:disabled)'))`),'in-flight launch restored');
  const afterClose=await view();assert.equal(afterClose.panes.length,last.panes.length+2);assert.equal(await read('preset-a.txt'),contents.a+'A window-close\n');assert.equal(await read('preset-b.txt'),contents.b+'B window-close\n');
  await until(()=>evaluate(`(()=>{const rows=[...document.querySelectorAll('[data-terminal-id]')];return rows.length>0&&rows.every(e=>e.dataset.restoreState==='attached');})()`),'in-flight launched terminal attached');
  closeWhileLaunching={busy,alive,afterClose,a:await read('preset-a.txt'),b:await read('preset-b.txt')};await screenshot('terminal-script-close-waits-for-launch-and-layout');
 }
 let ordinaryClose=null;
 if(process.argv.includes('--terminal-script-ordinary-close')){
  const beforeOrdinary=await view(),paused=controls.pauseOwnedBackend();let alive=false,busy=false;
  try{
   await click('text:New terminal');busy=await evaluate(`(()=>{const e=[...document.querySelectorAll('.ws-window-toolbar button')].find(e=>e.textContent.trim()==='New terminal');return e?.disabled;})()`);assert.equal(busy,true);
   await requestClose('window');await delay(200);try{alive=await evaluate('document.readyState!==undefined');}catch{alive=false;}
   writeFileSync(join(output,'terminal-ordinary-close-held.json'),JSON.stringify({pid:paused.pid,busy,alive},null,2)+'\n');
  }finally{paused.resume();}
  assert.equal(alive,true,'normal window close waits for ordinary terminal creation');
  await closeReopen(true);await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(button)}+':not(:disabled)'))`),'ordinary terminal creation restored');
  const afterOrdinary=await view();assert.equal(afterOrdinary.panes.length,beforeOrdinary.panes.length+1);
  const newPane=afterOrdinary.panes.find(p=>!beforeOrdinary.panes.some(old=>old.paneId===p.paneId));assert.ok(newPane);
  await until(()=>evaluate(`document.querySelector('[data-terminal-id="${newPane.resourceId}"]')?.dataset.restoreState==='attached'`),'ordinary restored terminal attached');
  assert.equal(await read('preset-a.txt'),closeWhileLaunching?.a??contents.a);assert.equal(await read('preset-b.txt'),closeWhileLaunching?.b??contents.b);
  ordinaryClose={busy,alive,beforeOrdinary,afterOrdinary};await screenshot('terminal-ordinary-close-waits-for-creation-and-layout');
 }

 const finalView=await view(),finalExecutions=await Promise.all(finalView.panes.map(p=>controls.inspectPresetTerminal(p.resourceId)));
 for(let index=0;index<pids.length;index++){const current=finalExecutions.find(row=>row.id===pids[index].id);assert.equal(current?.pid,pids[index].pid);assert.equal(current?.executionId,pids[index].executionId);}

 writeFileSync(join(output,'terminal-script-execution.json'),JSON.stringify({presetId:preset.id,folder,snapshots,contents,pids:pids.map(p=>p.pid),restored,closeWhileLaunching,ordinaryClose,finalExecutions:finalExecutions.map(({id,executionId,pid,alive,cwd})=>({id,executionId,pid,alive,cwd})),errors:getPage().errors},null,2)+'\n');assert.deepEqual(getPage().errors,[]);
}
