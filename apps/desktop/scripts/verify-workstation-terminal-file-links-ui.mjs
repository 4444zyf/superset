import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {agentUiDriver} from './verify-workstation-agent-ui-driver.mjs';

export async function verifyWorkstationTerminalFileLinksUi(options) {
 const {getPage,click,screenshot,output,controls,closeReopen}=options;
 const {evaluate,until}=agentUiDriver(options);
 const scope=await evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);return {connectionId:d.connectionId,backendId:d.backendId,namespaceId:d.namespaceId,workspaceId:w.workspaceId,terminals:w.panes.filter(p=>p.kind==='terminal').map(p=>p.resourceId)};})()`);
 const query=(path,input)=>evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)}||d.backendId!==${JSON.stringify(scope.backendId)}||d.namespaceId!==${JSON.stringify(scope.namespaceId)})throw Error('Scope changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`);
 const workspace=await query('workspace.get',{id:scope.workspaceId});
 const originals=await Promise.all(scope.terminals.map(async id=>{const row=await controls.inspectPresetTerminal(id);assert.equal(row.alive,true);return {id:row.id,pid:row.pid,executionId:row.executionId,cwd:row.cwd};}));
 await click('text:New terminal');
 const terminal=await until(()=>evaluate(`[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,state:e.dataset.restoreState})).find(e=>e.state==='attached'&&!${JSON.stringify(scope.terminals)}.includes(e.id))`),'file link terminal attached');
 const selector=`[data-terminal-id="${terminal.id}"]`;
 const key=async(key,code,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await getPage().call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code,modifiers});};
 const command="printf 'one\\ntwo\\nthree 中文\\nfour\\n' > terminal-link.txt; printf '\\033[2J\\033[H%s\\n' 'terminal-link.txt:3:2'";
 await click(`${selector} .xterm-screen`);await getPage().call('Input.insertText',{text:command});await key('Enter',13);
 const file=await until(async()=>{try {const r=await query('filesystem.readFile',{workspaceId:scope.workspaceId,absolutePath:`${workspace.worktreePath}/terminal-link.txt`,maxBytes:4096});return r.kind==='bytes'?Buffer.from(r.content,'base64').toString():r.content;}catch{return null;}},'terminal created link fixture');
 assert.equal(file,'one\ntwo\nthree 中文\nfour\n');
 const execution=await controls.inspectPresetTerminal(terminal.id);
 assert.ok(execution.cols>0&&execution.rows>0);
 const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}+' .xterm-screen'),r=e.getBoundingClientRect();return {x:r.x+r.width/${execution.cols}*5.5,y:r.y+r.height/${execution.rows}*0.5,rect:{x:r.x,y:r.y,width:r.width,height:r.height},cols:${execution.cols},rows:${execution.rows}};})()`);
 const mouse=async(type,modifiers=0)=>getPage().call('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,modifiers,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 await mouse('mouseMoved');await delay(250);await screenshot('terminal-file-link-before');
 await mouse('mousePressed');await mouse('mouseReleased');
 assert.equal(await evaluate(`Boolean(document.querySelector('[data-workspace-files]'))`),false,'plain click keeps terminal selection');
 await mouse('mouseMoved',process.platform==='darwin'?4:2);await delay(250);await mouse('mousePressed',process.platform==='darwin'?4:2);await mouse('mouseReleased',process.platform==='darwin'?4:2);
 let opened=false;
 try {await until(()=>evaluate(`Boolean(document.querySelector('[data-workspace-files] .cm-content'))`),'original file viewer opens from terminal');opened=true;}
 finally {writeFileSync(join(output,'terminal-file-link-navigation.json'),JSON.stringify({scope,workspaceRoot:workspace.worktreePath,terminal,execution,point,opened,sourceRevision:process.env.GITHUB_SHA},null,2)+'\n');await screenshot(opened?'terminal-file-link-viewer':'terminal-file-link-missing-viewer');}
 const text=await evaluate(`document.querySelector('[data-workspace-files] .cm-content')?.textContent`);assert.ok(text.includes('three 中文'));
 const activeLine=await evaluate(`document.querySelector('[data-workspace-files] .cm-activeLine')?.textContent`);assert.equal(activeLine,'three 中文');
 await click('[data-workspace-files] .cm-content');await key('End',35);await getPage().call('Input.insertText',{text:' retained draft'});
 await screenshot('terminal-file-link-dirty-draft');
 await click('text:Terminal');await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`),'original terminal restored after viewer');
 const after=await controls.inspectPresetTerminal(terminal.id);assert.equal(after.pid,execution.pid);assert.equal(after.executionId,execution.executionId);
 await mouse('mouseMoved',process.platform==='darwin'?4:2);await delay(250);await mouse('mousePressed',process.platform==='darwin'?4:2);await mouse('mouseReleased',process.platform==='darwin'?4:2);
 await until(()=>evaluate(`Boolean(document.querySelector('[data-workspace-files] .cm-content'))`),'same file opened again from terminal');
 assert.ok(await evaluate(`document.querySelector('[data-workspace-files] .cm-content')?.textContent.includes('retained draft')`));
 const saved=await query('filesystem.readFile',{workspaceId:scope.workspaceId,absolutePath:`${workspace.worktreePath}/terminal-link.txt`,maxBytes:4096});assert.equal(saved.kind==='bytes'?Buffer.from(saved.content,'base64').toString():saved.content,file);
 await screenshot('terminal-file-link-retained-draft');
 await click('[data-workspace-files] .cm-content');await key('z',90,process.platform==='darwin'?4:2);
 await until(()=>evaluate(`!document.querySelector('[data-workspace-files] .cm-content')?.textContent.includes('retained draft')`),'original undo clears the fixture draft');
 await click('text:Terminal');await closeReopen();await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`),'same file-link terminal after window reopen');
 await mouse('mouseMoved',process.platform==='darwin'?4:2);await delay(250);await mouse('mousePressed',process.platform==='darwin'?4:2);await mouse('mouseReleased',process.platform==='darwin'?4:2);
 await until(()=>evaluate(`document.querySelector('[data-workspace-files] .cm-activeLine')?.textContent==='three 中文'`),'file link works after window reopen');await screenshot('terminal-file-link-window-reopen');
 for(const original of originals){const row=await controls.inspectPresetTerminal(original.id);assert.deepEqual({id:row.id,pid:row.pid,executionId:row.executionId,cwd:row.cwd},original);}
 assert.deepEqual(getPage().errors,[]);
 writeFileSync(join(output,'terminal-file-links-ui.json'),JSON.stringify({scope,originals,terminal,execution,activeLine,modifierClick:true,plainClickPreserved:true,originalFileEditor:true,draftRetainedAcrossTerminalSwitch:true,linkAfterWindowReopen:true,backendFileUnchanged:true,columnNavigation:false,urlNavigation:false,macOSVerified:false,sourceRevision:process.env.GITHUB_SHA,errors:getPage().errors},null,2)+'\n');
}
