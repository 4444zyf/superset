import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationPortDiscoveryUi(options, context) {
	const {
		getPage,
		click,
		screenshot,
		output,
		controls,
		closeReopen,
		observePortBrowserCalls,
	} = options;
	const {
		initial,
		read,
		launches,
		selector,
		terminal,
		execution,
		originals,
		report,
	} = context;
	const { evaluate, until } = agentUiDriver(options);
	const row = `[data-workspace-ports] [data-port="${initial.port}"]`;
	const result = {};
	report.discovery = result;
	const key = async () => {
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
				windowsVirtualKeyCode: 27,
			});
	};
	const openMenu = async () => {
		await click("text:Port");
		await until(
			() => evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`),
			"owning workspace discovered port row",
		);
		return evaluate(
			`({text:document.querySelector(${JSON.stringify(row)})?.innerText,apiAvailable:typeof window.directWorkstation.listPorts==='function',ports:[...document.querySelectorAll('[data-workspace-ports] [data-port]')].map(e=>Number(e.dataset.port))})`,
		);
	};
	result.firstRows = await openMenu();
	const copyCurrentPort = async (phase) => {
		assert.equal(typeof options.setClipboard, "function");
		assert.equal(typeof options.readClipboardText, "function");
		await options.setClipboard({ text: "COPY-SENTINEL" });
		const copyButton = `${row} button[aria-label="Copy localhost:${initial.port}"]`;
		await until(
			() =>
				evaluate(
					`Boolean(document.querySelector(${JSON.stringify(copyButton)}))`,
				),
			"original row copy action",
		);
		const callsBeforeCopy = await observePortBrowserCalls();
		await click(copyButton);
		const copied = await until(async () => {
			const value = await options.readClipboardText();
			return value.startsWith("http://127.0.0.1:") ? value : null;
		}, "local clipboard receives prepared workspace address");
		const shown = await until(
			() =>
				evaluate(
					`document.querySelector('[role=menu] code.text-xs')?.textContent===${JSON.stringify(copied)}?document.querySelector('[role=menu] code.text-xs').textContent:null`,
				),
			"copied forward displayed",
		);
		assert.equal(copied, shown);
		assert.deepEqual(await observePortBrowserCalls(), callsBeforeCopy);
		const response = await fetch(copied);
		const body = await response.text();
		assert.equal(response.status, 200);
		assert.ok(body.includes(initial.marker));
		const copiedResult = {
			copied,
			shown,
			status: response.status,
			body,
			callsBeforeCopy,
			callsAfterCopy: await observePortBrowserCalls(),
		};
		await screenshot(`ports-copy-${phase}`);
		const closePosition = await evaluate(
			`(()=>{const b=document.querySelector('[role=menu] code.text-xs')?.parentElement?.querySelector('button');const r=b?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
		);
		assert.ok(closePosition);
		for (const type of ["mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...closePosition,
				button: "left",
				clickCount: 1,
			});
		await until(
			() => evaluate(`!document.querySelector('[role=menu] code.text-xs')`),
			"copied forward closed",
		);
		await assert.rejects(fetch(copied, { signal: AbortSignal.timeout(1000) }));
		return copiedResult;
	};
	if (process.argv.includes("--port-copy"))
		result.copy = await copyCurrentPort("first");
	const before = await observePortBrowserCalls();
	await click(`${row} .tabular-nums`);
	assert.deepEqual(
		await observePortBrowserCalls(),
		before,
		"the unconnected primary browser action is not silently external",
	);
	const position = await evaluate(
		`(()=>{const e=document.querySelector(${JSON.stringify(row)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...position,
	});
	await until(
		() =>
			evaluate(
				`(()=>{const b=document.querySelector(${JSON.stringify(row)}+' button');return b&&Number(getComputedStyle(b.parentElement).opacity)===1;})()`,
			),
		"original row action visible on hover",
	);
	await screenshot("ports-discovered-before-open");
	await click(
		`${row} button[aria-label="Open localhost:${initial.port} in external browser"]`,
	);
	result.forwardUrl = await until(
		() =>
			evaluate(
				`document.querySelector('[role=menu] code.text-xs')?.textContent`,
			),
		"discovered row opened its forward",
	);
	const target = new URL(result.forwardUrl);
	assert.equal(target.hostname, "127.0.0.1");
	result.browserProof = await until(async () => {
		const proof = await read();
		return proof.requests.some((r) => r.userAgent?.includes("Chrome/"))
			? proof
			: null;
	}, "real browser requested discovered service");
	result.firstCalls = await observePortBrowserCalls();
	assert.equal(result.firstCalls.length, before.length + 1);
	result.firstLaunches = launches();
	assert.equal(new URL(result.firstLaunches.at(-1).url).href, target.href);
	await getPage().call("Page.bringToFront");
	await screenshot("ports-discovered-open");
	const close = await evaluate(
		`(()=>{const e=document.querySelector('[role=menu] code.text-xs')?.parentElement?.querySelector('button');const r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
	);
	assert.ok(close);
	for (const type of ["mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			...close,
			button: "left",
			clickCount: 1,
		});
	await until(
		() => evaluate(`!document.querySelector('[role=menu] code.text-xs')`),
		"forward closed without killing the service",
	);
	await assert.rejects(
		fetch(result.forwardUrl, { signal: AbortSignal.timeout(1000) }),
	);
	assert.equal((await read()).running, true);
	await key();
	await closeReopen();
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
			),
		"same service terminal after reopening",
	);
	const retained = await controls.inspectPresetTerminal(terminal.id);
	assert.equal(retained.pid, execution.pid);
	assert.equal(retained.executionId, execution.executionId);
	report.retained = retained;
	result.reopenedRows = await openMenu();
	if (process.argv.includes("--port-copy"))
		result.copyReopened = await copyCurrentPort("reopened");
	await screenshot("ports-discovered-reopened");
	let paused;
	try {
		paused = controls.pauseOwnedBackend();
		result.pausedOwnedBackendPid = paused.pid;
		await click("[data-workspace-ports] button");
		await until(
			() =>
				evaluate(
					`document.querySelector('[data-workspace-ports] button')?.getAttribute('aria-busy')==='true'`,
				),
			"discovery read pending",
		);
		await key();
		await until(
			() => evaluate(`!document.querySelector('[role=menu]')`),
			"menu closed during read",
		);
		await click(".ws-window-toolbar:first-child button:first-child");
		await until(
			() => evaluate(`!document.querySelector('.ws-workspace-window')`),
			"workspace left during port read",
		);
		await screenshot("ports-read-pending-away");
		paused.resume();
		paused = undefined;
		result.afterRead = await read();
		for (const original of originals) {
			const current = await controls.inspectPresetTerminal(original.id);
			assert.deepEqual(
				{
					id: current.id,
					pid: current.pid,
					executionId: current.executionId,
					cwd: current.cwd,
				},
				original,
			);
		}
		assert.equal(
			await evaluate(
				`Boolean(document.querySelector('[data-workspace-ports]'))`,
			),
			false,
		);
		result.afterCalls = await observePortBrowserCalls();
		assert.deepEqual(result.afterCalls, []);
		report.errors = getPage().errors;
		assert.deepEqual(report.errors, []);
		report.discoveryFinished = true;
		await screenshot("ports-read-settled-away");
	} finally {
		paused?.resume();
		writeFileSync(
			join(output, "port-discovery-ui.json"),
			`${JSON.stringify(result, null, 2)}\n`,
		);
	}
}
