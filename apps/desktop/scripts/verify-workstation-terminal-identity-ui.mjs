import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {agentUiDriver} from './verify-workstation-agent-ui-driver.mjs';

export async function verifyWorkstationTerminalIdentityUi(options) {
 const {getPage,click,screenshot,output,controls,closeReopen}=options;
 const {evaluate,until}=agentUiDriver(options);
 const scope=await evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);return {connectionId:d.connectionId,backendId:d.backendId,namespaceId:d.namespaceId,workspaceId:w.workspaceId,terminals:w.panes.filter(p=>p.kind==='terminal').map(p=>p.resourceId)};})()`);
 const query=(path,input)=>evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)}||d.backendId!==${JSON.stringify(scope.backendId)}||d.namespaceId!==${JSON.stringify(scope.namespaceId)})throw Error('Scope changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`);
 const workspace=await query('workspace.get',{id:scope.workspaceId});
 const originals=await Promise.all(scope.terminals.map(async id=>{const row=await controls.inspectPresetTerminal(id);assert.equal(row.alive,true);return {id:row.id,pid:row.pid,executionId:row.executionId,cwd:row.cwd};}));
 await click('text:New terminal');
 const terminal=await until(()=>evaluate(`[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,state:e.dataset.restoreState})).find(e=>e.state==='attached'&&!${JSON.stringify(scope.terminals)}.includes(e.id))`),'identity terminal attached');
 const selector=`[data-terminal-id="${terminal.id}"]`;
 const read=async()=>{const r=await query('filesystem.readFile',{workspaceId:scope.workspaceId,absolutePath:`${workspace.worktreePath}/terminal-identity-proof.json`,maxBytes:4096});return JSON.parse(r.kind==='bytes'?Buffer.from(r.content,'base64').toString():r.content);};
 const run=async phase=>{
  const script=[
   'import base64,json,os,select,sys,termios,time,tty',
   'from pathlib import Path',
   'fd=sys.stdin.fileno(); previous=termios.tcgetattr(fd); response=b""',
   'try:',
   ' tty.setraw(fd); os.write(sys.stdout.fileno(),b"\\x1b[>q"); deadline=time.monotonic()+2',
   ' while b"\\x1b\\\\" not in response and time.monotonic()<deadline:',
   '  ready,_,_=select.select([fd],[],[],max(0,deadline-time.monotonic()))',
   '  if not ready: break',
   '  response+=os.read(fd,4096)',
   'finally:',
   ' termios.tcsetattr(fd,termios.TCSADRAIN,previous)',
   `result={"phase":${JSON.stringify(phase)},"termProgram":os.environ.get("TERM_PROGRAM"),"termProgramVersion":os.environ.get("TERM_PROGRAM_VERSION"),"term":os.environ.get("TERM"),"colorTerm":os.environ.get("COLORTERM"),"replyBase64":base64.b64encode(response).decode()}`,
   'Path("terminal-identity-proof.json").write_text(json.dumps(result)+"\\n")',
   'print("TERMINAL IDENTITY PROBE COMPLETE",result["phase"],flush=True)',
  ].join('\n');
  execFileSync('python3',['-c','import sys; compile(sys.stdin.read(), "terminal-identity-probe", "exec")'],{input:script});
  const payload=Buffer.from(script).toString('base64');
  const command="python3 -c 'import base64;exec(base64.b64decode(\""+payload+"\"))'";
  const focusState=()=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {documentFocused:document.hasFocus(),paneActive:e?.closest('[data-active]')?.getAttribute('data-active'),textareaFocused:Boolean(e?.contains(document.activeElement)&&document.activeElement?.matches('textarea')),attached:e?.dataset.restoreState==='attached'};})()`);
  const beforeFocus=await focusState();
  await getPage().call('Page.bringToFront');
  await click(`${selector} .xterm-screen`);
  await until(async()=>{const state=await focusState();writeFileSync(join(output,`terminal-identity-focus-${phase}.json`),JSON.stringify({before:beforeFocus,after:state},null,2)+'\n');return state.documentFocused&&state.paneActive==='true'&&state.textareaFocused&&state.attached?state:null;},'identity terminal owns keyboard focus');
  await evaluate(`(()=>{window.__identityInputEvents=[];for(const type of ['beforeinput','input','keydown','keyup'])document.addEventListener(type,e=>{window.__identityInputEvents.push({type,inputType:e.inputType,dataLength:e.data?.length,key:e.key,code:e.code,defaultPrevented:e.defaultPrevented,target:e.target?.className});if(window.__identityInputEvents.length>32)window.__identityInputEvents.shift();},true);return true;})()`);
  await getPage().call('Input.insertText',{text:command});
  for(const type of ['keyDown','keyUp'])await getPage().call('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  let proof,inspected;
  try {proof=await until(async()=>{try {const v=await read();return v.phase===phase?v:null;}catch{return null;}},'actual terminal identity probe');}
  finally {
   const inputEvents=await evaluate(`window.__identityInputEvents`);
   inspected=await controls.inspectPresetTerminal(terminal.id);
   writeFileSync(join(output,`terminal-identity-input-${phase}.json`),JSON.stringify({inputEvents,inspected},null,2)+'\n');
  }
  writeFileSync(join(output,`terminal-identity-${phase}.json`),JSON.stringify(proof,null,2)+'\n');
  await screenshot(`terminal-identity-${phase}`);
  assert.equal(proof.termProgram,null,'the shell does not claim kitty or inherit a parent terminal identity');
  assert.equal(proof.termProgramVersion,null);
  assert.equal(proof.term,'xterm-256color');
  assert.equal(proof.colorTerm,'truecolor');
  assert.equal(Buffer.from(proof.replyBase64,'base64').toString(),'\x1bP>|Superset Remix (xterm.js)\x1b\\');
  assert.equal(inspected.output.includes('>|Superset Remix (xterm.js)'),false,'historical protocol replies must not become shell input');
  return proof;
 };
 const first=await run('first');
 const execution=await controls.inspectPresetTerminal(terminal.id);
 await closeReopen();
 await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`),'same identity terminal after reopen');
 const second=await run('reopened');
 const retained=await controls.inspectPresetTerminal(terminal.id);
 assert.equal(retained.pid,execution.pid);assert.equal(retained.executionId,execution.executionId);
 for(const original of originals){const row=await controls.inspectPresetTerminal(original.id);assert.deepEqual({id:row.id,pid:row.pid,executionId:row.executionId,cwd:row.cwd},original);}
 assert.deepEqual(getPage().errors,[]);
 writeFileSync(join(output,'terminal-identity-ui.json'),JSON.stringify({scope,originals,execution,retained,first,second,sourceRevision:process.env.GITHUB_SHA,realVendorVerified:false,macOSVerified:false,errors:getPage().errors},null,2)+'\n');
}
