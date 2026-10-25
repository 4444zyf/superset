import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	configureWorkstationWebview,
	guardWorkstationWebviews,
} from "./workstation-browser-security";

test("renderer webpreferences cannot add a preload, Node access, another partition or insecure content", () => {
	let blocked = false;
	const preferences: Electron.WebPreferences & { preloadURL?: string } = {
		preload: "/untrusted/preload.js",
		preloadURL: "file:///untrusted/preload.js",
		nodeIntegration: true,
		contextIsolation: false,
		sandbox: false,
		webSecurity: false,
		partition: "persist:other",
	};
	configureWorkstationWebview(
		{
			preventDefault: () => {
				blocked = true;
			},
		},
		preferences,
		{ src: "https://example.com/", partition: "persist:superset" },
	);
	expect(blocked).toBe(false);
	expect(preferences).toEqual({
		nodeIntegration: false,
		nodeIntegrationInWorker: false,
		nodeIntegrationInSubFrames: false,
		contextIsolation: true,
		sandbox: true,
		webSecurity: true,
		allowRunningInsecureContent: false,
		webviewTag: false,
		plugins: false,
		partition: "persist:superset",
	});
});

test("initial webview attachment uses the original guest URL scheme policy", () => {
	for (const [src, expected] of [
		["about:blank", false],
		["http://127.0.0.1:3000/path?q=1#section", false],
		["https://example.com/", false],
		["file:///etc/passwd", true],
		["javascript:alert(1)", true],
		["chrome://version", true],
		["devtools://devtools/", true],
		["data:text/html,<script>1</script>", true],
	] as const) {
		let blocked = false;
		configureWorkstationWebview(
			{
				preventDefault: () => {
					blocked = true;
				},
			},
			{},
			{ src, partition: "persist:superset" },
		);
		expect(blocked).toBe(expected);
	}
});

test("a webview cannot attach to an arbitrary persistent or host session", () => {
	for (const partition of [undefined, "", "persist:other", "temporary"]) {
		let blocked = false;
		configureWorkstationWebview(
			{
				preventDefault: () => {
					blocked = true;
				},
			},
			{},
			{ src: "https://example.com/", partition },
		);
		expect(blocked).toBe(true);
	}
});

test("before registration a guest cannot open windows or navigate or redirect to a local file", () => {
	const host = new EventEmitter();
	let open: (() => { action: string }) | null = null;
	const guest = Object.assign(new EventEmitter(), {
		setWindowOpenHandler: (handler: () => { action: string }) => {
			open = handler;
		},
	});
	guardWorkstationWebviews(host);
	host.emit("did-attach-webview", {}, guest);
	if (!open) throw new Error("Missing window-open handler");
	expect((open as () => { action: string })()).toEqual({ action: "deny" });
	for (const type of ["will-navigate", "will-redirect"]) {
		let blocked = false;
		guest.emit(
			type,
			{
				preventDefault: () => {
					blocked = true;
				},
			},
			"file:///etc/passwd",
		);
		expect(blocked).toBe(true);
	}
	guest.emit("destroyed");
	expect(guest.listenerCount("will-navigate")).toBe(0);
	expect(guest.listenerCount("will-redirect")).toBe(0);
});
