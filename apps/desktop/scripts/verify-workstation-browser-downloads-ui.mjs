import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { writeFileSync } from "node:fs";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
const filename = "report 中文.txt",
	existing = "pre-existing downloaded file\n";
const payload = (marker, kind) =>
	Buffer.from((marker + "|" + kind + "|").repeat(4096));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function driver(options) {
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const snapshot = () =>
		evaluate("window.directWorkstation.browser.downloads.getSnapshot()");
	const open = async () => {
		await menu.open();
		const items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		return {
			items,
			show: async () => {
				assert.ok(
					items.includes("Downloads"),
					"original Downloads menu action is available",
				);
				await menu.select("Downloads");
				await until(
					() =>
						evaluate(
							"(()=>{const d=[...document.querySelectorAll('[role=dialog]')].find(e=>e.querySelector('h2')?.textContent==='Downloads');return d&&d.getAnimations().every(a=>a.playState==='finished');})()",
						),
					"original downloads dialog",
				);
			},
		};
	};
	const close = async () => {
		await options.click("[role=dialog] [data-slot=dialog-close]");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"downloads dialog closes",
		);
	};
	const rowPoint = async (name, label) =>
		until(
			() =>
				evaluate(
					`(()=>{const name=[...document.querySelectorAll('[role=dialog] .text-foreground')].find(e=>e.textContent===${JSON.stringify(name)});const row=name?.closest('button')?.parentElement,e=row?.querySelector(${JSON.stringify('button[aria-label="' + label + '"]')});if(!e)return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===hit||e.contains(hit)?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
				),
			"download row control visible",
		);
	const press = async (point) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await options.getPage().call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
	};
	return { evaluate, until, snapshot, open, close, rowPoint, press };
}
function verifyFile(directory, row, marker, kind) {
	assert.equal(basename(row.filename), row.filename);
	const path = join(directory, row.filename),
		bytes = readFileSync(path),
		expected = payload(marker, kind);
	assert.equal(hash(bytes), hash(expected));
	return { filename: row.filename, bytes: bytes.length, sha256: hash(bytes) };
}
export async function verifyWorkstationBrowserDownloadsUi(options, context) {
	const { click, getPage, output, screenshot, readBrowserDownloadDirectory } =
			options,
		{ url, marker, guestRead, key, readView, workspace, observeGuest } =
			context;
	const { evaluate, until, snapshot, open, close, rowPoint, press } =
		driver(options);
	const report = { files: [], marker };
	const save = () =>
		writeFileSync(
			join(output, "browser-downloads-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const directory = resolve(output, "../downloads");
	const pageClick = async (selector) => {
		const inner = `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`;
		const point = await evaluate(
			`(async()=>{const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible'),p=await v.executeJavaScript(${JSON.stringify(inner)});const r=v.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};})()`,
		);
		await press(point);
	};

	const navigate = async (target) => {
		const blank = await evaluate(
			"Boolean([...document.querySelectorAll('[data-workstation-browser-toolbar] button')].find(e=>e.textContent.trim()==='Enter URL or search...'))",
		);
		await click(
			blank
				? "text:Enter URL or search..."
				: "[data-workstation-browser-toolbar] button.group",
		);
		await until(
			() =>
				evaluate(
					"document.activeElement?.matches('[data-workstation-browser-toolbar] input')",
				),
			"address editing",
		);
		await key("a", "KeyA", process.platform === "darwin" ? 4 : 2);
		await getPage().call("Input.insertText", { text: target });
		await key("Enter", "Enter");
		await until(
			async () => (await guestRead("document.body.innerText")).includes(marker),
			"owned page restored in new browser pane",
		);
	};
	try {
		report.directory = await readBrowserDownloadDirectory();
		assert.equal(
			report.directory,
			directory,
			"Electron uses the owned XDG download directory",
		);
		assert.equal(readFileSync(join(directory, filename), "utf8"), existing);
		report.capability = await evaluate(
			"Boolean(window.directWorkstation.browser?.downloads)",
		);
		const initial = await open();
		report.items = initial.items;
		save();
		await initial.show();
		assert.equal(report.capability, true);
		await until(
			() =>
				evaluate(
					"document.querySelector('[role=dialog]')?.textContent.includes('No downloads yet')",
				),
			"real empty downloads list",
		);
		await screenshot("browser-downloads-empty");
		await close();
		await pageClick("#download-a");
		await pageClick("#download-b");
		report.concurrent = await until(async () => {
			const r = (await snapshot()).rows;
			return r.length === 2 &&
				r.every((e) => e.state === "progressing" && e.receivedBytes > 0)
				? r
				: null;
		}, "two same-name downloads remain active concurrently");
		assert.deepEqual(report.concurrent.map((r) => r.filename).sort(), [
			"report 中文 (1).txt",
			"report 中文 (2).txt",
		]);
		const ids = new Set(report.concurrent.map((r) => r.id));
		await pageClick("#download-cancel");
		report.cancelTarget = await until(
			async () =>
				(await snapshot()).rows.find(
					(r) =>
						!ids.has(r.id) && r.state === "progressing" && r.receivedBytes > 0,
				),
			"third active download",
		);
		const list = await open();
		await list.show();
		await screenshot("browser-downloads-progress");
		await press(
			await rowPoint(report.cancelTarget.filename, "Cancel download"),
		);
		report.cancelled = await until(
			async () =>
				(await snapshot()).rows.find(
					(r) => r.id === report.cancelTarget.id && r.state === "cancelled",
				),
			"real Electron cancellation updates row",
		);
		await click("text:Clear list");
		report.afterClearActive = await until(async () => {
			const r = (await snapshot()).rows;
			return r.length === 2 &&
				r.every((e) => ids.has(e.id) && e.state === "progressing")
				? r
				: null;
		}, "clear removes finished row and preserves both active transfers");
		await screenshot("browser-downloads-clear-active");
		await close();
		const pane = workspace(await readView()).panes.find(
			(p) => p.kind === "browser",
		);
		assert.ok(pane);
		await press(
			await evaluate(
				`(()=>{const e=document.querySelector('input[data-pane-title-id="${pane.paneId}"]')?.parentElement.parentElement.querySelector('button[aria-label="Close pane"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
			),
		);
		await until(
			() =>
				evaluate("!document.querySelector('[data-workstation-browser-pane]')"),
			"origin browser pane actually closes",
		);
		await click("[data-workstation-new-browser]");
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-browser-pane]'))",
				),
			"new browser pane",
		);
		await observeGuest();
		const background = await open();
		await background.show();
		report.afterPaneClose = await until(async () => {
			const r = (await snapshot()).rows;
			return r.length === 2 &&
				r.every((e) => ids.has(e.id) && e.state === "progressing")
				? r
				: null;
		}, "downloads survive origin pane closure");
		await screenshot("browser-downloads-origin-closed");
		await close();
		await navigate(url);
		report.releaseBefore = await guestRead(
			"(()=>{const e=document.querySelector('#release-downloads');window.__ownedReleaseClicks=0;e.addEventListener('click',()=>window.__ownedReleaseClicks++);return {ready:document.readyState,handler:typeof e.onclick,attribute:e.getAttribute('onclick'),paint:performance.getEntriesByType('paint').map(p=>({name:p.name,time:p.startTime}))};})()",
		);
		await screenshot("browser-downloads-ready-to-release");
		report.releaseReady = await until(
			() =>
				guestRead(
					"(()=>{const paint=performance.getEntriesByType('paint').map(p=>({name:p.name,time:p.startTime}));return paint.some(p=>p.name==='first-contentful-paint')?{paint}:null;})()",
				),
			"replacement page content is painted before the next real input",
		);
		await pageClick("#release-downloads");
		report.releaseAfter = await guestRead(
			"({clicks:window.__ownedReleaseClicks,ready:document.readyState,paint:performance.getEntriesByType('paint').map(p=>({name:p.name,time:p.startTime}))})",
		);
		save();
		report.completed = await until(async () => {
			const r = (await snapshot()).rows;
			return r.length === 2 &&
				r.every(
					(e) =>
						ids.has(e.id) &&
						e.state === "completed" &&
						e.receivedBytes === e.totalBytes,
				)
				? r
				: null;
		}, "both real files complete after closing origin pane");
		const kinds = new Set();
		for (const row of report.completed) {
			const actual = hash(readFileSync(join(directory, row.filename))),
				kind = ["a", "b"].find((k) => hash(payload(marker, k)) === actual);
			assert.ok(kind);
			kinds.add(kind);
			report.files.push(verifyFile(directory, row, marker, kind));
		}
		assert.equal(kinds.size, 2);
		assert.equal(readFileSync(join(directory, filename), "utf8"), existing);
		const completed = await open();
		await completed.show();
		await screenshot("browser-downloads-completed");
		await click("text:Clear list");
		await until(
			async () => (await snapshot()).rows.length === 0,
			"clear completed metadata",
		);
		await close();
		for (const file of report.files)
			assert.ok(
				existsSync(join(directory, file.filename)),
				"clearing metadata retains downloaded file",
			);
		await pageClick("#download-finished");
		report.persisted = await until(
			async () => (await snapshot()).rows.find((r) => r.state === "completed"),
			"new completed row for normal reopen",
		);
		report.files.push(
			verifyFile(directory, report.persisted, marker, "finished"),
		);
		await pageClick("#download-hold");
		report.beforeQuit = await until(
			async () =>
				(await snapshot()).rows.find(
					(r) =>
						r.id !== report.persisted.id &&
						r.state === "progressing" &&
						r.receivedBytes > 0,
				),
			"partial real transfer before normal app quit",
		);
		report.errors = getPage().errors;
		assert.deepEqual(report.errors, []);
		return report;
	} catch (error) {
		report.failure = {
			name: error.name,
			message: error.message,
			actual: error.actual,
			expected: error.expected,
		};
		throw error;
	} finally {
		if (report.capability) {
			report.finalSnapshot = await snapshot();
			report.serverAtEnd = await context.readProof();
			report.guestAtEnd = await guestRead(
				"({url:location.href,ready:document.readyState,clicks:window.__ownedReleaseClicks})",
			);
		}
		report.hostAtEnd = await evaluate(
			"(()=>{const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible');return {pointerEvents:v?.style.pointerEvents,bodyPointer:document.body.style.pointerEvents,passthrough:document.documentElement.hasAttribute('data-pointer-passthrough'),console:window.__ownedBrowserConsole??[]};})()",
		);
		if (!report.errors) await screenshot("browser-downloads-incomplete");
		save();
		if (
			await evaluate(
				"Boolean([...document.querySelectorAll('[role=dialog] h2')].find(e=>e.textContent==='Downloads'))",
			)
		) {
			if (!report.errors) await screenshot("browser-downloads-incomplete");
			await close();
		}
	}
}
export async function verifyWorkstationBrowserDownloadsReopened(
	options,
	expected,
) {
	const { until, snapshot, open, close } = driver(options),
		list = await open();
	await list.show();
	const report = {};
	try {
		report.rows = await until(async () => {
			const r = (await snapshot()).rows;
			return r.some(
				(e) => e.id === expected.persisted.id && e.state === "completed",
			) &&
				r.some(
					(e) => e.id === expected.beforeQuit.id && e.state === "interrupted",
				)
				? r
				: null;
		}, "completed file persists and stopped partial transfer reopens as interrupted");
		await options.screenshot("browser-downloads-reopened");
		await options.click("text:Clear list");
		await until(
			async () => (await snapshot()).rows.length === 0,
			"finished and interrupted entries clear after restart",
		);
		for (const file of expected.files) {
			const bytes = readFileSync(join(expected.directory, file.filename));
			assert.equal(hash(bytes), file.sha256);
		}
		assert.equal(
			readFileSync(join(expected.directory, filename), "utf8"),
			existing,
		);
		report.filesStillPresent = true;
		await options.screenshot("browser-downloads-reopened-cleared");
		return report;
	} finally {
		await close();
		writeFileSync(
			join(options.output, "browser-downloads-reopened.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	}
}
