import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {agentUiDriver} from './verify-workstation-agent-ui-driver.mjs';

export async function verifyWorkstationTerminalClipboardUi(options) {
 const {getPage,click,screenshot,setClipboard,pasteClipboard,readClipboardText,output,scope,terminal,query}=options;
 const {evaluate,until}=agentUiDriver(options);
 const selector=`[data-terminal-id="${terminal.terminalId}"]`;
 const path=scope.root+'/terminal-agent-clipboard.json';
 const copied='COPY SSH 中文 🙂 DONE',osc='AGENT OSC52 中文 🙂';
 const program=`import os,sys,tty,termios,json,base64\nf=sys.stdin.fileno();old=termios.tcgetattr(f);received=[];stage='raw'\ndef state():\n size=os.get_terminal_size(f);open(${JSON.stringify(path)},'w').write(json.dumps({'received':received,'stage':stage,'cols':size.columns,'rows':size.lines}))\ntry:\n tty.setraw(f);sys.stdout.write('\\x1b[?1049h\\x1b[?1000h\\x1b[?1006h\\x1b[?2004h\\x1b[2J\\x1b[H'+${JSON.stringify(copied)}+'\\r\\nRAW AGENT CLIPBOARD');sys.stdout.flush();state()\n while True:\n  data=os.read(f,4096);received.append(data.hex())\n  if data==b'o':\n   sys.stdout.write('\\x1b]52;c;'+base64.b64encode(${JSON.stringify(osc)}.encode()).decode()+'\\x07');sys.stdout.flush();stage='osc52'\n  elif data==b'q': stage='finished';state();break\n  state()\nfinally:\n sys.stdout.write('\\x1b[?2004l\\x1b[?1000l\\x1b[?1006l\\x1b[?1049l');sys.stdout.flush();termios.tcsetattr(f,termios.TCSADRAIN,old)\n`;
 const key=async(key,code,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await getPage().call('Input.dispatchKeyEvent',{type,key,code:key.length===1?'Key'+key.toUpperCase():key,windowsVirtualKeyCode:code,modifiers});};
 await getPage().call('Input.insertText',{text:"python3 -u -c \"exec(bytes.fromhex('"+Buffer.from(program).toString('hex')+"').decode())\""});await key('Enter',13);
 const state=async()=>{try{const r=await query('filesystem.readFile',{absolutePath:path,maxBytes:128*1024});return JSON.parse(r.kind==='text'?r.content:Buffer.from(r.content,'base64').toString());}catch{return null;}};
 await until(async()=>(await state())?.stage==='raw','raw agent clipboard fixture');
 const initial=await state();
 const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}+' .xterm-screen').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
 const cellWidth=rect.width/initial.cols,cellHeight=rect.height/initial.rows;
 const start={x:rect.x+1,y:rect.y+cellHeight/2},end={x:rect.x+22*cellWidth,y:start.y};
 for(const e of [{type:'mousePressed',...start,button:'left',clickCount:1},{type:'mouseMoved',...end,button:'left',buttons:1},{type:'mouseReleased',...end,button:'left',clickCount:1}])await getPage().call('Input.dispatchMouseEvent',{...e,modifiers:8});
 await setClipboard({text:'copy sentinel'});
 await key('C',67,10);
 await until(async()=>await readClipboardText()===copied,'Ctrl Shift C copies TUI selection');
 await screenshot('agent-clipboard-keyboard-copy');
 const menu=async()=>{for(const type of ['mousePressed','mouseReleased'])await getPage().call('Input.dispatchMouseEvent',{type,button:'right',clickCount:1,x:start.x+cellWidth*3,y:start.y,modifiers:8});await until(()=>evaluate(`Boolean(document.querySelector('[role=menu]'))`),'terminal clipboard menu');};
 await setClipboard({text:'menu copy sentinel'});await menu();await click('menu:Copy');
 await until(async()=>await readClipboardText()===copied,'menu copies TUI selection');
 await until(()=>evaluate(`!document.querySelector('[role=menu]')`),'clipboard menu fully closes');
 const copyFocus=await until(()=>evaluate(`(()=>{const e=document.activeElement;return e?.matches('.xterm-helper-textarea')&&e.closest('[data-terminal-id]')?.dataset.terminalId===${JSON.stringify(terminal.terminalId)}&&{tag:e.tagName,terminalId:e.closest('[data-terminal-id]').dataset.terminalId};})()`),'copy returns focus to the same terminal');
 writeFileSync(join(output,'agent-clipboard-copy-focus.json'),JSON.stringify(copyFocus,null,2)+'\n');
 assert.deepEqual((await state()).received,[],'selection and copy do not send input to the agent');
 const phases=[];
 for(const [method,plain] of [['keyboard','中文 prompt 🙂\nsecond line\n'],['menu','menu paste 中文\nline two\n']]) {
  const previous=await state();await setClipboard({text:plain});
  if(method==='keyboard')await pasteClipboard();else {await menu();await click('menu:Paste');}
  const expected='\x1b[200~'+plain.replace(/\n/g,'\r')+'\x1b[201~';
  const current=await until(async()=>{const s=await state();return s&&Buffer.from(s.received.slice(previous.received.length).join(''),'hex').toString()===expected&&s;},method+' multiline bracketed paste');
  phases.push({method,plain,expected,previous,current});await screenshot('agent-clipboard-'+method+'-paste');
 }
 const previousImage=await state();await setClipboard({imageBase64:readFileSync(join(output,'clipboard-image-source.png')).toString('base64')});await menu();await click('menu:Paste');
 const imageInput=await until(async()=>{const s=await state();if(!s)return null;const bytes=Buffer.from(s.received.slice(previousImage.received.length).join(''),'hex').toString();return bytes.startsWith('\x1b[200~')&&bytes.endsWith('\x1b[201~')&&bytes.includes(scope.root+'/.superset/attachments/')&&{state:s,bytes};},'agent receives bracketed remote image path');
 await screenshot('agent-clipboard-remote-image');
 await click('text:Files');await until(()=>evaluate(`Boolean(document.querySelector('[data-workspace-files]'))`),'files before clipboard remount');await click('text:Terminal');
 await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"] .xterm-screen'))`),'same agent terminal reattached');
 await until(()=>evaluate(`document.activeElement?.closest('[data-terminal-id]')?.dataset.terminalId===${JSON.stringify(terminal.terminalId)}`),'agent focused after remount');
 await setClipboard({text:'OSC52 sentinel'});await getPage().call('Input.insertText',{text:'o'});
 await until(async()=>await readClipboardText()===osc,'remote TUI OSC52 copies to local clipboard after remount');
 await screenshot('agent-clipboard-osc52-after-remount');
 await getPage().call('Input.insertText',{text:'q'});await until(async()=>(await state())?.stage==='finished','agent input remains usable');
 assert.deepEqual(getPage().errors,[]);
 writeFileSync(join(output,'terminal-agent-clipboard-ui.json'),JSON.stringify({terminal,selection:copied,keyboardCopy:true,menuCopy:true,copyFocus,phases,imageInput,osc52:osc,afterRemount:true,final:await state(),errors:getPage().errors,vendorAgentVerified:false},null,2)+'\n');
}
