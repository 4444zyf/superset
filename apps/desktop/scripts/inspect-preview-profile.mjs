import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "darwin");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const application = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const child = spawn(
	join(application, "Contents/MacOS/Superset SSH Preview"),
	["--inspect=127.0.0.1:19381", "--remote-debugging-port=19382"],
	{ stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
for (const stream of [child.stdout, child.stderr])
	stream.on("data", (bytes) => {
		log = (log + bytes).slice(-8192);
	});
async function target(port, predicate) {
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			const entries = await fetch(`http://127.0.0.1:${port}/json/list`).then(
				(r) => r.json(),
			);
			const entry = entries.find(predicate);
			if (entry) return entry;
		} catch {}
		if (child.exitCode !== null) throw new Error(`Old preview exited: ${log}`);
		await delay(100);
	}
	throw new Error(`Old preview inspector unavailable: ${log}`);
}
async function connect(entry) {
	const socket = new WebSocket(entry.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let next = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data));
		if (message.id) {
			const callback = pending.get(message.id);
			pending.delete(message.id);
			message.error
				? callback?.reject(new Error(message.error.message))
				: callback?.resolve(message.result);
		}
	});
	return {
		close: () => socket.close(),
		call: (method, params = {}) =>
			new Promise((resolve, reject) => {
				const id = ++next;
				pending.set(id, { resolve, reject });
				socket.send(JSON.stringify({ id, method, params }));
			}),
	};
}
let main;
let page;
try {
	main = await connect(await target(19381, (entry) => entry.type === "node"));
	const expression = `(() => { const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/brand-inspection.cjs'); const electron = require('electron'); const app = electron.app; if (!app.isReady() || !app.getAppPath().startsWith(${JSON.stringify(application)}) || !electron.BrowserWindow.getAllWindows().length) return null; const fs = require('node:fs'); const path = require('node:path'); const metadata = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')); return {name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'), appData: app.getPath('appData'), packageMetadata: {name: metadata.name, productName: metadata.productName, version: metadata.version}}; })()`;
	let response;
	for (let attempt = 0; attempt < 200; attempt++) {
		response = await main.call("Runtime.evaluate", { expression, returnByValue: true });
		if (!response.exceptionDetails && response.result?.value?.packaged) break;
		await delay(100);
	}
	assert.equal(response.exceptionDetails, undefined);
	const profile = response.result.value;
	assert.equal(profile.packaged, true);
	assert.equal(profile.name, profile.packageMetadata.productName);
	assert.equal(profile.version, "1.37.3");
	writeFileSync(
		join(output, "old-preview-profile.json"),
		JSON.stringify(profile, null, 2),
	);
	console.log(
		`::notice::${JSON.stringify({ name: profile.name, userData: profile.userData, appData: profile.appData, version: profile.version, packageName: profile.packageMetadata.name, productName: profile.packageMetadata.productName })}`,
	);
	const renderer = await target(
		19382,
		(entry) =>
			entry.type === "page" &&
			entry.url.startsWith("file:") &&
				decodeURI(entry.url).includes(application),
	);
	page = await connect(renderer);
	await delay(1500);
	const shot = await page.call("Page.captureScreenshot", { format: "png" });
	writeFileSync(
		join(output, "old-preview.png"),
		Buffer.from(shot.data, "base64"),
	);
	await main.call("Runtime.evaluate", {
		expression:
			"setTimeout(() => process.getBuiltinModule('module').createRequire(process.cwd() + '/brand-inspection.cjs')('electron').app.quit(), 100)",
	});
} finally {
	page?.close();
	main?.close();
	if (child.exitCode === null) child.kill("SIGTERM");
	if (child.exitCode === null) {
		await Promise.race([
			new Promise((resolve) => child.once("close", resolve)),
			delay(3000).then(() => child.kill("SIGKILL")),
		]);
	}
}
