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
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const restoreWindows = process.argv.includes("--restore-windows");
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
for (const port of [19391, 19392]) {
	let occupied = false;
	try {
		await fetch(`http://127.0.0.1:${port}/json/list`, {
			signal: AbortSignal.timeout(500),
		});
		occupied = true;
	} catch {}
	assert.equal(occupied, false, `Inspector port ${port} is already occupied`);
}
const children = new Set();
function launch(debug = true) {
	const child = spawn(
		executable,
		[
			...(debug
				? ["--inspect=127.0.0.1:19391", "--remote-debugging-port=19392"]
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
			errors.push(message.params.exceptionDetails.text);
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
	const point = await page.evaluate(
		`(() => { const selector=${JSON.stringify(selector)}; const e = selector.startsWith("text:") ? [...document.querySelectorAll("button,[data-tab-id]")].find(b=>b.textContent.trim()===selector.slice(5)) : document.querySelector(selector); if (!e) throw new Error('Missing visible input'); const r = e.getBoundingClientRect(); if (r.y < 0 || r.bottom > innerHeight) throw new Error('Input is outside viewport'); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`,
	);
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
		19392,
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
		await target(19391, (entry) => entry.type === "node", child),
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
		`${JSON.stringify(metadata, null, 2)}\n`,
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
	child = launch();
	await attach();
	await screenshot("workstation");
	const second = launch(false);
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
	child = launch();
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
	if (!sourceTest || restoreWindows) {
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
		const { verifyWorkspaceRestoreUi } = await import(
			"./verify-workspace-restore-ui.mjs"
		);
		const verifyRestore = (controls) =>
			verifyWorkspaceRestoreUi({
				controls,
				samples: Number(
					process.argv
						.find((value) => value.startsWith("--restore-samples="))
						?.split("=")[1] ?? 20,
				),
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
					child = launch();
					await attach();
					return closedHeartbeat;
				},
				closeReopen: async () => {
					await main.evaluate(
						`${electron}.BrowserWindow.getAllWindows()[0].close(); true`,
					);
					await delay(700);
					page.close();
					page = undefined;
					if (process.platform !== "darwin") {
						main.close();
						main = undefined;
						await until(() => child.exitCode !== null);
						child = launch();
						await attach();
						return;
					}
					if (child.exitCode !== null) {
						main.close();
						main = undefined;
						child = launch();
						await attach();
					} else {
						await main.evaluate(`${electron}.app.emit('activate'); true`);
						main.close();
						main = undefined;
						await attach();
					}
				},
			});
		if (sourceTest) {
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
	await stop();
	writeFileSync(
		join(output, "brand-ui.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(
		`::notice::${JSON.stringify({ brand: brand.displayName, version, profile, sourceTest, singleInstance: true, reopen: true, offlineLicense: true, screenshots: 7 })}`,
	);
} catch (error) {
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
	if(page) { const view = await page.evaluate("window.directWorkstation.getWorkspaceView()").catch(()=>null); writeFileSync(join(output,"failure-view.json"),JSON.stringify(view,null,2)); }
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
