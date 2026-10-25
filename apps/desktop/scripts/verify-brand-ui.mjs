import {dragOnOwnedX11Window} from "./verify-native-drag-input.mjs";
import {driveOwnedX11FileDialog} from "./verify-native-file-dialog-input.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { pasteOnOwnedX11Window } from "./verify-native-paste-input.mjs";

const restoreWindows = process.argv.includes("--restore-windows");
const localParity = process.argv.includes("--local-parity-only");
const localWheel = process.argv.includes("--local-wheel-only") || localParity;
const sourceTest = process.argv.includes("--source-test");
if (!sourceTest) {
	assert.equal(process.platform, "darwin");
	assert.equal(process.env.GITHUB_ACTIONS, "true");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const brand = JSON.parse(
	readFileSync(join(root, "packages/shared/src/product-brand.json"), "utf8"),
);
const application = resolve(process.argv[2]);
const canonicalApplication = realpathSync(application);
const output = resolve(process.argv[3]);
const version = JSON.parse(
	readFileSync(join(root, "apps/desktop/package.json"), "utf8"),
).version;
const executable = sourceTest
	? process.env.BRAND_VERIFY_EXECUTABLE
	: join(application, "Contents/MacOS", brand.displayName);
assert.ok(executable);
const appData =
	process.platform === "darwin"
		? join(homedir(), "Library/Application Support")
		: process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const profile = join(
	appData,
	sourceTest
		? `${brand.slug}-dev-${createHash("sha256")
				.update(process.env.SUPERSET_WORKSPACE_ID?.trim() || application)
				.digest("hex")}`
		: brand.desktopDataProfile,
);
assert.equal(
	existsSync(profile),
	false,
	`UI acceptance requires a fresh profile: ${profile}`,
);
mkdirSync(output, { recursive: true });
let inspectPorts;
async function freshInspectPorts() {
 const servers = [createServer(), createServer()];
 try {
  const ports = await Promise.all(servers.map(server => new Promise((resolve, reject) => {
   server.once('error', reject);
   server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  })));
  return {main: ports[0], renderer: ports[1]};
 } finally {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
 }
}
const children = new Set();
async function launch(debug = true) {
 if (debug) inspectPorts = await freshInspectPorts();
	const child = spawn(
		executable,
		[
			...(debug
				? [`--inspect=127.0.0.1:${inspectPorts.main}`, `--remote-debugging-port=${inspectPorts.renderer}`]
				: []),
			"--lang=en-US",
			...(sourceTest
				? [
						"--no-sandbox",
						"--disable-dev-shm-usage",
						"--disable-gpu",
						application,
					]
				: []),
		],
		{ cwd: application, stdio: ["ignore", "pipe", "pipe"] },
	);
	children.add(child);
	child.once("error", (error) => {
		child.failure = error;
	});
	child.log = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (bytes) => {
			child.log = (child.log + bytes).slice(-12000);
		});
	return child;
}
async function target(port, predicate, child) {
	for (let attempt = 0; attempt < 300; attempt++) {
		try {
			const entries = await fetch(`http://127.0.0.1:${port}/json/list`, {
				signal: AbortSignal.timeout(1000),
			}).then((r) => r.json());
			const entry = entries.find(predicate);
			if (entry) return entry;
		} catch {}
		if (child.failure || child.exitCode !== null)
			throw new Error(`Application exited: ${child.failure || child.log}`);
		await delay(100);
	}
	throw new Error(`Inspector unavailable: ${child.log}`);
}
async function connect(entry) {
	const socket = new WebSocket(entry.webSocketDebuggerUrl);
	await new Promise((accept, reject) => {
		socket.addEventListener("open", accept, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let next = 0;
	const pending = new Map();
	const errors = [];
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data));
		if (message.id) {
			const callback = pending.get(message.id);
			pending.delete(message.id);
			if (!callback) return;
			clearTimeout(callback.timer);
			message.error
				? callback.reject(new Error(message.error.message))
				: callback.accept(message.result);
		} else if (message.method === "Runtime.exceptionThrown")
			errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
		else if (
			message.method === "Runtime.consoleAPICalled" &&
			message.params.type === "error"
		)
			errors.push(
				message.params.args.map((a) => a.value || a.description).join(" "),
			);
	});
	const call = (method, params = {}) =>
		new Promise((accept, reject) => {
			const id = ++next;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Timeout: ${method}`));
			}, 10000);
			pending.set(id, { accept, reject, timer });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await call("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ||
					result.exceptionDetails.text,
			);
		return result.result.value;
	};
	return { call, evaluate, errors, close: () => socket.close() };
}
async function until(read, predicate = Boolean) {
	for (let attempt = 0; attempt < 200; attempt++) {
		const value = await read();
		if (predicate(value)) return value;
		await delay(100);
	}
	throw new Error("UI condition timed out");
}
let main, page, child;
let ownedSourceFixture;
const evidence = {
	sourceTest,
	application,
	version,
	source: process.env.GITHUB_SHA,
	observations: [],
};
const electron = `process.getBuiltinModule('module').createRequire(process.cwd() + '/brand-verification.cjs')('electron')`;
async function stop() {
	await main.evaluate(`setTimeout(() => ${electron}.app.quit(), 100); true`);
	page.close();
	main.close();
	page = main = undefined;
	await until(async () => child.exitCode !== null);
	assert.equal(child.exitCode, 0, child.log);
}
async function click(selector) {
	const point = await until(() => page.evaluate(
		`(() => { const selector=${JSON.stringify(selector)}; const visible=e=>{if(!e||e.matches(':disabled'))return false;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.top<0||r.left<0||r.bottom>innerHeight||r.right>innerWidth)return false;const root=e.getRootNode();const hit=(root.elementFromPoint?root:document).elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit);};const candidates = selector.startsWith("tree:") ? [...document.querySelectorAll("file-tree-container")].flatMap(host=>[...(host.shadowRoot?.querySelectorAll('[data-item-path='+JSON.stringify(selector.slice(5))+']:not([data-file-tree-sticky-row])')??[])]) : selector.startsWith("menu:") ? [...document.querySelectorAll("[role=menuitem]")].filter(e=>e.textContent.trim()===selector.slice(5)) : selector.startsWith("text:") ? [...document.querySelectorAll("button,[data-tab-id]")].filter(b=>b.textContent.trim()===selector.slice(5)) : [...document.querySelectorAll(selector)]; const e=candidates.find(visible);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	));
	await page.call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...point,
	});
	await page.call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		...point,
	});
}
async function screenshot(name) {
	await page.evaluate("document.fonts.ready.then(() => true)");
	await delay(150);
	const result = await page.call("Page.captureScreenshot", { format: "png" });
	writeFileSync(
		join(output, `${name}.png`),
		Buffer.from(result.data, "base64"),
	);
}
async function attach() {
	const renderer = await target(
		inspectPorts.renderer,
		(entry) => {
			if (entry.type !== "page" || !entry.url.startsWith("file:")) return false;
			try {
				const marker = sourceTest
					? "/dist/renderer/"
					: "/Contents/Resources/app.asar/";
				const rootPath = fileURLToPath(entry.url).split(marker);
				return (
					rootPath.length === 2 &&
					realpathSync(rootPath[0]) === canonicalApplication
				);
			} catch {
				return false;
			}
		},
		child,
	);
	main = await connect(
		await target(inspectPorts.main, (entry) => entry.type === "node", child),
	);
	const metadata = await until(() =>
		main.evaluate(`(() => {
 const {app, BrowserWindow} = ${electron};
 if (!app?.isReady() || !BrowserWindow.getAllWindows().length) return null;
 const fs = process.getBuiltinModule('fs');
 const metadata = JSON.parse(fs.readFileSync(app.getAppPath() + '/package.json', 'utf8'));
 return {pid:process.pid,name:app.getName(), version:app.getVersion(), packaged:app.isPackaged, appPath:app.getAppPath(), userData:app.getPath('userData'), sessionData:app.getPath('sessionData'), appData:app.getPath('appData'), metadata}; })()`),
	);
	writeFileSync(
		join(output, "observed-identity.json"),
		`${JSON.stringify({...metadata, inspectPorts, rendererUrl: renderer.url}, null, 2)}\n`,
	);
	assert.equal(
		realpathSync(metadata.appPath),
		sourceTest
			? canonicalApplication
			: join(canonicalApplication, "Contents/Resources/app.asar"),
	);
	assert.equal(metadata.pid, child.pid);
	assert.equal(metadata.packaged, !sourceTest);
	assert.equal(metadata.name, brand.displayName);
	assert.equal(metadata.version, version);
	assert.equal(metadata.userData, profile);
	assert.equal(metadata.sessionData, profile);
	assert.equal(metadata.metadata.productName, brand.displayName);
	if (!sourceTest) {
		assert.equal(metadata.metadata.name, brand.slug);
		assert.equal(metadata.metadata.forkSource, process.env.GITHUB_SHA);
	}
	evidence.identity = metadata;
	evidence.rendererUrl = renderer.url;
	page = await connect(renderer);
	await page.call("Runtime.enable");
	await page.call("Page.enable");
	await until(() =>
		page.evaluate("Boolean(document.querySelector('.ws-about-button'))"),
	);
	assert.equal(await page.evaluate("document.title"), brand.displayName);
}
try {
	child = await launch();
	await attach();
	await screenshot("workstation");
	const second = await launch(false);
	await until(async () => second.failure || second.exitCode !== null);
	assert.equal(second.exitCode, 0, second.log);
	assert.equal(
		await main.evaluate(`${electron}.BrowserWindow.getAllWindows().length`),
		1,
	);
	evidence.singleInstance = true;
	await click('[data-slot=sidebar-content] button[aria-label="Workspaces"]');
	await click('[data-slot=sidebar-content] button[aria-label="SSH machines"]');
	await click(".ws-about-button");
	await until(
		() =>
			page.evaluate("document.querySelector('.ws-about-version')?.textContent"),
		(value) => value?.includes(version),
	);
	assert.equal(
		await page.evaluate(
			"document.querySelector('[role=dialog] h2').textContent",
		),
		`About ${brand.displayName}`,
	);
	assert.equal(
		await page.evaluate(
			"document.querySelectorAll('.ws-about-links button').length",
		),
		5,
	);
	await screenshot("about");
	await click(".ws-about details:last-of-type summary");
	assert.equal(
		await page.evaluate(
			"document.querySelector('.ws-about details:last-of-type pre').textContent",
		),
		readFileSync(join(root, "LICENSE.md"), "utf8"),
	);
	await screenshot("license");
	const pos = await page.evaluate(
		"(() => { const r=document.querySelector('.ws-about').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()",
	);
	await page.call("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		deltaX: 0,
		deltaY: 1000,
		...pos,
	});
	await delay(250);
	const scroll = await page.evaluate(
		"document.querySelector('.ws-about').scrollTop",
	);
	assert.ok(scroll > 0);
	evidence.observations.push({ licenseScrollTop: scroll });
	await screenshot("license-scrolled");
	await page.call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await page.call("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await until(() => page.evaluate("!document.querySelector('[role=dialog]')"));
	await main.evaluate(
		`${electron}.BrowserWindow.getAllWindows()[0].setSize(800,600); true`,
	);
	await delay(250);
	const layout = await page.evaluate(`(() => {
 const aboutButton=document.querySelector('.ws-about-button').getBoundingClientRect();
 const name=document.querySelector('.ws-native-brand span'); const rect=name.getBoundingClientRect();
 return {width:innerWidth,height:innerHeight,aboutButtonBottom:aboutButton.bottom,aboutButtonTop:aboutButton.top,nameWidth:rect.width,nameScrollWidth:name.scrollWidth}; })()`);
	assert.ok(
		layout.aboutButtonTop >= 0 && layout.aboutButtonBottom <= layout.height,
	);
	assert.ok(layout.nameWidth >= layout.nameScrollWidth - 1);
	evidence.observations.push(layout);
	await screenshot("minimum-window");
	await click(".ws-about-button");
	await until(
		() =>
			page.evaluate("document.querySelector('.ws-about-version')?.textContent"),
		(value) => value?.includes(version),
	);
	await screenshot("about-minimum-window");
	assert.deepEqual(page.errors, []);
	await stop();
	child = await launch();
	await attach();
	await click(".ws-about-button");
	await until(
		() =>
			page.evaluate("document.querySelector('.ws-about-version')?.textContent"),
		(value) => value?.includes(version),
	);
	assert.deepEqual(page.errors, []);
	evidence.reopen = true;
	await screenshot("reopened-about");
	if (!sourceTest || restoreWindows || localWheel) {
		await page.call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
		});
		await page.call("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
		});
		await until(() =>
			page.evaluate("!document.querySelector('[role=dialog]')"),
		);
		await main.evaluate(
			`${electron}.BrowserWindow.getAllWindows()[0].setSize(1200,900); true`,
		);
		await delay(250);
		const verifyWorkspaceRestoreUi = localWheel
			? localParity ? (await import("./verify-workstation-local-parity-ui.mjs")).verifyWorkstationLocalParityUi : (await import("./verify-workstation-local-wheel-ui.mjs")).verifyWorkstationLocalWheelUi
			: (await import("./verify-workspace-restore-ui.mjs")).verifyWorkspaceRestoreUi;
		const verifyRestore = (controls) =>
			verifyWorkspaceRestoreUi({
				controls,
				pasteClipboard:
					process.platform === "linux"
						? async () => {
								const id = await main.evaluate(
									`${electron}.BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE()`,
								);
								pasteOnOwnedX11Window(id);
							}
						: undefined,
 nativeDrag: process.platform==='linux'?async(points)=>{
  const owner=await main.evaluate(`({ownerWindowId:${electron}.BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(),ownerPid:process.pid,contentBounds:${electron}.BrowserWindow.getAllWindows()[0].getContentBounds()})`);
  const viewport=await page.evaluate(`({width:innerWidth,height:innerHeight,scale:devicePixelRatio})`);
  return dragOnOwnedX11Window({...owner,viewport,points});
 }:undefined,
 nativeFileDialog: process.platform==='linux'?async(action)=>{
 const owner=await main.evaluate(`({ownerWindowId:${electron}.BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(),ownerPid:process.pid})`);
 return driveOwnedX11FileDialog({...owner,action});
 }:undefined,
				setClipboard: async (value) =>
					main.evaluate(
						`(()=>{const e=${electron};e.clipboard.clear();${value.fileUri ? `e.clipboard.writeBuffer('text/uri-list',Buffer.from(${JSON.stringify(value.fileUri + "\r\n")}));` : value.imageBase64 ? `e.clipboard.writeImage(e.nativeImage.createFromBuffer(Buffer.from(${JSON.stringify(value.imageBase64)},'base64')));` : `e.clipboard.writeText(${JSON.stringify(value.text)});`}const image=e.clipboard.readImage();return {formats:e.clipboard.availableFormats(),image:image.isEmpty()?null:{size:image.getSize(),pixelSha256:process.getBuiltinModule('crypto').createHash('sha256').update(image.toBitmap()).digest('hex')}};})()`,
					),
				readClipboardText: async () => main.evaluate(`${electron}.clipboard.readText()`),
				inspectClipboardImage: async (base64) =>
					main.evaluate(
						`(()=>{const image=${electron}.nativeImage.createFromBuffer(Buffer.from(${JSON.stringify(base64)},'base64'));return {size:image.getSize(),pixelSha256:process.getBuiltinModule('crypto').createHash('sha256').update(image.toBitmap()).digest('hex')};})()`,
					),
				samples: Number(
					process.argv
						.find((value) => value.startsWith("--restore-samples="))
						?.split("=")[1] ?? 20,
				),
    readBrowserDownloadDirectory:async()=>{
     assert.ok(process.argv.includes("--browser-downloads"));
     return main.evaluate(`(()=>{if(process.pid!==${child.pid})throw Error('Wrong owned app');return ${electron}.app.getPath('downloads');})()`);
    },
    inspectBrowserTools: async () => {
     assert.ok(process.argv.includes("--browser-tools"));
     return main.evaluate(`(()=>{if(process.pid!==${child.pid})throw Error('Wrong owned app');const owner=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents.id;return ${electron}.webContents.getAllWebContents().filter(w=>!w.isDestroyed()&&w.getType()==='webview'&&w.hostWebContents?.id===owner).map(w=>({id:w.id,url:w.getURL(),zoom:w.getZoomFactor(),devToolsOpened:w.isDevToolsOpened(),devToolsId:w.devToolsWebContents?.id??null,devToolsUrl:w.devToolsWebContents?.getURL()??null,devToolsLoading:w.devToolsWebContents?.isLoading()??false}));})()`);
    },

    inspectBrowserDevTools: async (guestId) => {
     assert.ok(process.argv.includes("--browser-tools")&&Number.isInteger(guestId));
     return main.evaluate(`(async()=>{if(process.pid!==${child.pid})throw Error('Wrong owned app');const owner=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents.id,w=${electron}.webContents.fromId(${guestId});if(!w||w.getType()!=='webview'||w.hostWebContents?.id!==owner||!w.isDevToolsOpened()||!w.devToolsWebContents)throw Error('Wrong owned guest');const content=await w.devToolsWebContents.executeJavaScript("(()=>{let trees=0,treeItems=0,text='',nodes=0;function scan(root){for(const node of root.childNodes){if(++nodes>5000)return;if(node.nodeType===1&&(node.tagName==='STYLE'||node.tagName==='SCRIPT'))continue;if(node.nodeType===3){if(text.length<32768)text+=node.textContent;}else{if(node.getAttribute?.('role')==='tree')trees++;if(node.getAttribute?.('role')==='treeitem')treeItems++;if(node.shadowRoot)scan(node.shadowRoot);scan(node);}}}scan(document.body);return {trees,treeItems,text:text.slice(0,32768),nodes};})()");return {title:w.devToolsWebContents.getTitle(),url:w.devToolsWebContents.getURL(),...content};})()`);
    },
    captureBrowserDevTools: async (guestId) => {
     assert.ok(process.argv.includes("--browser-tools")&&Number.isInteger(guestId));
     return main.evaluate(`(async()=>{if(process.pid!==${child.pid})throw Error('Wrong owned app');const owner=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents.id;const w=${electron}.webContents.fromId(${guestId});if(!w||w.getType()!=='webview'||w.hostWebContents?.id!==owner||!w.isDevToolsOpened()||!w.devToolsWebContents)throw Error('Wrong owned guest');let timer;try{const image=await Promise.race([w.devToolsWebContents.capturePage(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Owned DevTools capture timed out')),10000))]);return image.toPNG().toString('base64');}finally{clearTimeout(timer);}})()`);
    },
    closeBrowserDevTools: async (guestId) => {
     assert.ok(process.argv.includes("--browser-tools")&&Number.isInteger(guestId));
     return main.evaluate(`(()=>{if(process.pid!==${child.pid})throw Error('Wrong owned app');const w=${electron}.webContents.fromId(${guestId}),owner=${electron}.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))?.webContents.id;if(!w||w.getType()!=='webview'||w.hostWebContents?.id!==owner)throw Error('Wrong owned guest');w.closeDevTools();return true;})()`);
    },

				observePortBrowserCalls: async () => {
					assert.ok(process.argv.includes("--ports-only"));
					return main.evaluate(`(()=>{if(process.pid!==${child.pid})throw Error('Wrong owned app');if(!globalThis.__ownedPortBrowserCalls){const calls=[];const shell=${electron}.shell;const original=shell.openExternal;shell.openExternal=function(...args){calls.push({url:args[0]});if(calls.length>64)calls.shift();return Reflect.apply(original,this,args);};globalThis.__ownedPortBrowserCalls=calls;}return globalThis.__ownedPortBrowserCalls;})()`);
				},
				getPage: () => page,
				click,
				screenshot,
				output,
				restart: async (mode) => {
					if (mode === "force") {
						child.kill("SIGKILL");
						page.close();
						main.close();
						page = main = undefined;
						await until(
							() => child.signalCode !== null || child.exitCode !== null,
						);
					} else await stop();
					const closedHeartbeat = await controls?.observeWhileClientClosed();
					child = await launch();
					await attach();
					return closedHeartbeat;
				},
				isWindowOpen: async () => {if (!child || child.exitCode !== null || child.signalCode !== null || !main) return false;try{return await main.evaluate(`(()=>{if(process.pid!==${child.pid})throw new Error('Wrong owned app');return ${electron}.BrowserWindow.getAllWindows().length===1;})()`);}catch(error){writeFileSync(join(output,'window-liveness-error.json'),JSON.stringify({pid:child.pid,error:String(error)},null,2)+'\n');return false;}},
				requestClose: async (kind) => main.evaluate(`${kind==="both"?`${electron}.BrowserWindow.getAllWindows()[0].close();${electron}.app.quit()` : kind==="quit"?`${electron}.app.quit()` : `${electron}.BrowserWindow.getAllWindows()[0].close()`};true`),
    closeReopen: async (alreadyClosed = false) => {
					if (!alreadyClosed) await main.evaluate(
						`${electron}.BrowserWindow.getAllWindows()[0].close(); true`,
					);
					await delay(700);
					page.close();
					page = undefined;
					if (process.platform !== "darwin") {
						main.close();
						main = undefined;
						await until(() => child.exitCode !== null);
						child = await launch();
						await attach();
						return;
					}
					if (child.exitCode !== null) {
						main.close();
						main = undefined;
						child = await launch();
						await attach();
					} else {
						await main.evaluate(`${electron}.app.emit('activate'); true`);
						main.close();
						main = undefined;
						await attach();
					}
				},
			});
		if (sourceTest && localWheel) {
			const { LocalNamespaceBackend } = await import("../../../packages/direct-connection/src/local-namespaces.ts");
			const localBackend = new LocalNamespaceBackend({
				dataDir: join(profile, "direct-workstation/local-backend"),
				execPath: executable,
				supervisorPath: join(application, "dist/main/direct-supervisor.js"),
				hostServicePath: join(application, "dist/main/direct-backend.js"),
				migrationsFolder: join(application, "dist/resources/host-migrations"),
				chatMigrationsFolder: join(application, "dist/resources/chat-migrations"),
			});
			ownedSourceFixture = {close: async () => {
				for (const row of localBackend.listNamespaces()) {
					localBackend.selectNamespace(row.id);
					await localBackend.stop();
				}
			}};
			const {ownedRestoreControls} = await import("./verify-restore-controls.mjs");
			await verifyRestore({forNamespace(namespaceId) {
				const row = localBackend.listNamespaces().find(row => row.namespaceId === namespaceId);
				assert.ok(row);
				const home = join(profile, "direct-workstation/local-backend", ...(row.isDefault ? [] : ["namespaces", row.id]));
				return ownedRestoreControls(home, {homeDir: home});
			}});
		} else if (sourceTest) {
			const { sourceSshFixture } = await import(
				"./verify-source-ssh-fixture.mjs"
			);
			ownedSourceFixture = await sourceSshFixture(root);
			await click(
				'[data-slot=sidebar-content] button[aria-label="SSH machines"]',
			);
			await click(".ws-heading > button.primary");
			for (const [name, value] of Object.entries({
				name: "Restore Linux fixture",
				host: ownedSourceFixture.alias,
			})) {
				await click('input[name="' + name + '"]');
				await page.call("Input.insertText", { text: value });
			}
			await click('.ws-drawer-form button[type="submit"]');
			await until(() =>
				page.evaluate("!document.querySelector('.ws-drawer-form')"),
			);
			await click(".ws-detail-actions button.primary");
			await until(() =>
				page.evaluate(
					"document.querySelector('[data-slot=sidebar-content] button[aria-label=\"Workspaces\"]')?.getAttribute('aria-current')==='page'",
				),
			);
			await verifyRestore(ownedSourceFixture.controls);
		} else {
			const { verifySshUi } = await import("./verify-ssh-ui.mjs");
			await verifySshUi({
				page,
				click,
				screenshot,
				resources: join(application, "Contents/Resources/resources"),
				verifyRestore,
				output,
			});
		}
	}
	if (process.argv.includes("--browser-history-ipc-only")) {
		assert.equal(sourceTest, true);
		const { verifyWorkstationBrowserHistoryIpc } = await import("./verify-workstation-browser-history-ipc.mjs");
		await verifyWorkstationBrowserHistoryIpc({
			getPage: () => page,
			evaluateMain: (expression) => main.evaluate(expression),
			restart: async () => {
				await stop();
				child = await launch();
				await attach();
			},
			profile,
			output,
			source: process.env.GITHUB_SHA,
		});
	}
	await stop();
	writeFileSync(
		join(output, "brand-ui.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(
		`::notice::${JSON.stringify({ brand: brand.displayName, version, profile, sourceTest, singleInstance: true, reopen: true, offlineLicense: true, screenshots: 7 })}`,
	);
} catch (error) {
	if (page) writeFileSync(join(output,"failure-console.json"),JSON.stringify(page.errors,null,2));
	if (page) {
		await screenshot("failure").catch(() => {});
		const bounds = await page
			.evaluate(
				"[...document.querySelectorAll('.ws-workspace-pane,.xterm-screen,.ws-pane-grid,.ws-main-body')].map(e=>({className:e.className,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))",
			)
			.catch(() => []);
		writeFileSync(
			join(output, "failure-bounds.json"),
			JSON.stringify(bounds, null, 2),
		);
	}
	if (page) {
		const view = await page
			.evaluate("window.directWorkstation.getWorkspaceView()")
			.catch(() => null);
		writeFileSync(
			join(output, "failure-view.json"),
			JSON.stringify(view, null, 2),
		);
	}
	throw error;
} finally {
	if (ownedSourceFixture)
		await ownedSourceFixture
			.close()
			.catch((error) => console.error(error.message));
	if (main) {
		try {
			await main.evaluate(
				`setTimeout(() => ${electron}.app.quit(), 100); true`,
			);
		} catch {}
	}
	writeFileSync(
		join(output, "application-log.txt"),
		[...children].map((owned) => owned.log).join("\n"),
	);
	page?.close();
	main?.close();
	for (const owned of children) {
		if (owned.exitCode === null) owned.kill("SIGTERM");
	}
	await Promise.all(
		[...children].map(async (owned) => {
			if (owned.exitCode === null)
				await Promise.race([
					new Promise((resolve) => owned.once("close", resolve)),
					delay(3000),
				]);
			if (owned.exitCode === null) owned.kill("SIGKILL");
		}),
	);
}
