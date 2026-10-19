import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
export function dragOnOwnedX11Window({ownerWindowId,ownerPid,contentBounds,viewport,points}) {
 assert.equal(process.platform,'linux');
 for(const value of [ownerWindowId,ownerPid])assert.ok(Number.isSafeInteger(value)&&value>0);
 assert.equal(viewport.scale,1);assert.equal(contentBounds.width,viewport.width);
 const menuOffset=contentBounds.height-viewport.height;assert.ok(menuOffset>=0&&menuOffset<=64);
 const id='0x'+ownerWindowId.toString(16),props=execFileSync('xprop',['-id',id,'_NET_WM_PID'],{encoding:'utf8'});
 assert.equal(Number(/_NET_WM_PID\(CARDINAL\) = (\d+)/.exec(props)?.[1]),ownerPid);
 const info=execFileSync('xwininfo',['-id',id],{encoding:'utf8'});assert.match(info,/Map State:\s+IsViewable/);
 const origin={x:contentBounds.x,y:contentBounds.y+menuOffset};
 assert.ok(Array.isArray(points)&&points.length>=2&&points.length<=64);
 const physical=points.map(p=>{assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<viewport.width&&p.y>=0&&p.y<viewport.height);return {x:Math.round(origin.x+p.x),y:Math.round(origin.y+p.y)};});
 execFileSync('python3',['-c',String.raw`
import ctypes,ctypes.util,sys,json,time
x=ctypes.CDLL(ctypes.util.find_library('X11'));t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.argtypes=[ctypes.c_char_p];x.XOpenDisplay.restype=ctypes.c_void_p
d=x.XOpenDisplay(None)
if not d:raise RuntimeError('No owned X11 display')
x.XSetInputFocus.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_ulong]
x.XGetInputFocus.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_ulong),ctypes.POINTER(ctypes.c_int)]
x.XSync.argtypes=[ctypes.c_void_p,ctypes.c_int];x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
w=int(sys.argv[1]);points=json.loads(sys.argv[2]);x.XSetInputFocus(d,w,2,0);x.XSync(d,0)
focus=ctypes.c_ulong();revert=ctypes.c_int();x.XGetInputFocus(d,ctypes.byref(focus),ctypes.byref(revert))
if focus.value!=w:raise RuntimeError('Owned native window did not receive focus')
try:
 p=points[0];t.XTestFakeMotionEvent(d,-1,p['x'],p['y'],0);x.XSync(d,0);time.sleep(.1)
 t.XTestFakeButtonEvent(d,1,1,0);x.XSync(d,0);time.sleep(.1)
 for p in points[1:]:
  t.XTestFakeMotionEvent(d,-1,p['x'],p['y'],0);x.XSync(d,0);time.sleep(.07)
 time.sleep(.5)
finally:
 t.XTestFakeButtonEvent(d,1,0,0);x.XSync(d,0);x.XCloseDisplay(d)
`,String(ownerWindowId),JSON.stringify(physical)],{stdio:'pipe'});
 return {ownerWindowId,ownerPid,contentBounds,viewport,menuOffset,origin,physicalPoints:physical,nativeXTest:true};
}
