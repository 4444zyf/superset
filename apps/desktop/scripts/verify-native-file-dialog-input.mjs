import {execFileSync} from "node:child_process";

function inspectOwnedFileDialog(ownerWindowId,ownerPid) {
 const tree=execFileSync('xwininfo',['-root','-tree'],{encoding:'utf8'});
 for(const match of tree.matchAll(/\b(0x[0-9a-f]+)\s+"([^"\n]*)"/gi)){
  const id=Number.parseInt(match[1],16),title=match[2];
  if(id===ownerWindowId||!/^open(?:\s+file)?$/i.test(title))continue;
  try{
   const info=execFileSync('xwininfo',['-id',match[1]],{encoding:'utf8'});
   if(!/Map State:\s+IsViewable/.test(info))continue;
   const props=execFileSync('xprop',['-id',match[1],'_NET_WM_PID','WM_TRANSIENT_FOR'],{encoding:'utf8'});
   const pid=Number(/_NET_WM_PID\(CARDINAL\) = (\d+)/.exec(props)?.[1]);
   const transient=Number.parseInt(/WM_TRANSIENT_FOR.*?# (0x[0-9a-f]+)/i.exec(props)?.[1]??'0',16);
   if(pid!==ownerPid&&transient!==ownerWindowId)continue;
   return {windowId:id,title,pid:Number.isSafeInteger(pid)?pid:null,transientFor:transient,ownedByPid:pid===ownerPid,ownedByTransient:transient===ownerWindowId};
  }catch{}
 }
 return null;
}
export function driveOwnedX11FileDialog({ownerWindowId,ownerPid,action}) {
 if(process.platform!=='linux'||![ownerWindowId,ownerPid].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Invalid owned file dialog target');
 if(!['inspect','choose','confirm','cancel'].includes(action))throw new Error('Unsupported native file dialog action');
 const dialog=inspectOwnedFileDialog(ownerWindowId,ownerPid);
 if(!dialog||action==='inspect')return dialog;
 execFileSync('python3',['-c',String.raw`
import ctypes,ctypes.util,sys,time
x=ctypes.CDLL(ctypes.util.find_library('X11'));t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.argtypes=[ctypes.c_char_p];x.XOpenDisplay.restype=ctypes.c_void_p
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No owned X11 display')
x.XSetInputFocus.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_ulong]
x.XGetInputFocus.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_ulong),ctypes.POINTER(ctypes.c_int)]
x.XStringToKeysym.argtypes=[ctypes.c_char_p];x.XStringToKeysym.restype=ctypes.c_ulong
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong];x.XKeysymToKeycode.restype=ctypes.c_uint
x.XSync.argtypes=[ctypes.c_void_p,ctypes.c_int];x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
w=int(sys.argv[1]);x.XSetInputFocus(d,w,2,0);x.XSync(d,0)
focus=ctypes.c_ulong();revert=ctypes.c_int();x.XGetInputFocus(d,ctypes.byref(focus),ctypes.byref(revert))
if focus.value!=w: raise RuntimeError('Owned native dialog did not receive focus')
def press(name):
 c=x.XKeysymToKeycode(d,x.XStringToKeysym(name.encode()));t.XTestFakeKeyEvent(d,c,1,10);t.XTestFakeKeyEvent(d,c,0,10);x.XSync(d,0)
def chord(name):
 c=x.XKeysymToKeycode(d,x.XStringToKeysym(b'Control_L'));key=x.XKeysymToKeycode(d,x.XStringToKeysym(name.encode()))
 for k,p in [(c,1),(key,1),(key,0),(c,0)]:t.XTestFakeKeyEvent(d,k,p,10)
 x.XSync(d,0)
try:
 action=sys.argv[2]
 if action=='cancel':press('Escape')
 elif action=='confirm':press('Return')
 elif action=='choose':
  chord('l');time.sleep(0.1);chord('v');time.sleep(0.1);press('Return')
finally:x.XCloseDisplay(d)
`,String(dialog.windowId),action],{stdio:'pipe'});
 return dialog;
}
