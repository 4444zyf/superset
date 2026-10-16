import { execFileSync } from "node:child_process";

export function pasteOnOwnedX11Window(windowId) {
	if (!Number.isSafeInteger(windowId) || windowId <= 0)
		throw new Error("Invalid owned window");
	execFileSync(
		"python3",
		[
			"-c",
			`
import ctypes,ctypes.util,sys
x=ctypes.CDLL(ctypes.util.find_library('X11'));t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.argtypes=[ctypes.c_char_p];x.XOpenDisplay.restype=ctypes.c_void_p
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No X11 display')
x.XSetInputFocus.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_ulong]
x.XStringToKeysym.argtypes=[ctypes.c_char_p];x.XStringToKeysym.restype=ctypes.c_ulong
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong];x.XKeysymToKeycode.restype=ctypes.c_uint
x.XFlush.argtypes=[ctypes.c_void_p];x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
x.XSetInputFocus(d,int(sys.argv[1]),2,0)
c=x.XKeysymToKeycode(d,x.XStringToKeysym(b'Control_L'));v=x.XKeysymToKeycode(d,x.XStringToKeysym(b'v'))
for key,pressed in [(c,1),(v,1),(v,0),(c,0)]: t.XTestFakeKeyEvent(d,key,pressed,0)
x.XFlush(d);x.XCloseDisplay(d)
`,
			String(windowId),
		],
		{ stdio: "pipe" },
	);
}
