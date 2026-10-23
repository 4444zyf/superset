import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationTerminalUrlLinksUi(options, context) {
	const {
		getPage,
		screenshot,
		output,
		closeReopen,
		controls,
		observePortBrowserCalls,
	} = options;
	const {
		scope,
		initial,
		terminal,
		execution,
		originals,
		selector,
		read,
		launches,
		report,
	} = context;
	const { evaluate, until } = agentUiDriver(options);
	assert.ok(initial.url?.startsWith("http://localhost:"));
	const originalTarget = new URL(initial.url);
	const path = originalTarget.pathname + originalTarget.search;
	const requests = (proof) =>
		proof.requests.filter(
			(r) => r.path === path && r.userAgent?.includes("Chrome/"),
		).length;
	const gesture = (process.platform === "darwin" ? 4 : 2) | 8;
	const run = async (phase, row) => {
		await getPage().call("Page.bringToFront");
		const dims = await controls.inspectPresetTerminal(terminal.id);
		const point = await evaluate(
			`(()=>{const e=document.querySelector(${JSON.stringify(selector)}+' .xterm-screen'),r=e.getBoundingClientRect();return {x:r.x+r.width/${dims.cols}*5.5,y:r.y+r.height/${dims.rows}*(${row}+.5),height:r.height/${dims.rows},cols:${dims.cols},rows:${dims.rows}};})()`,
		);
		const mouse = async (type, modifiers = 0) =>
			getPage().call("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y: point.y,
				modifiers,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		const hover = async (modifiers) =>
			until(async () => {
				await getPage().call("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: point.x,
					y: point.y + point.height,
					modifiers,
				});
				await mouse("mouseMoved", modifiers);
				return evaluate(
					`document.querySelector(${JSON.stringify(selector)}+' .xterm-screen')?.classList.contains('xterm-cursor-pointer')`,
				);
			}, "original terminal URL hover");
		await evaluate(
			`(()=>{window.__ownedUrlInputEvents=[];document.addEventListener('click',e=>{if(!e.target?.closest?.(${JSON.stringify(selector)}))return;window.__ownedUrlInputEvents.push({button:e.button,ctrl:e.ctrlKey,meta:e.metaKey,shift:e.shiftKey,alt:e.altKey});if(window.__ownedUrlInputEvents.length>12)window.__ownedUrlInputEvents.shift();},true);return true;})()`,
		);
		const beforeCalls = await observePortBrowserCalls();
		const before = await read();
		await hover(0);
		await screenshot(`terminal-url-${phase}-before`);
		for (const modifiers of [0, process.platform === "darwin" ? 4 : 2]) {
			await hover(modifiers);
			await mouse("mousePressed", modifiers);
			await mouse("mouseReleased", modifiers);
		}
		assert.deepEqual(
			await observePortBrowserCalls(),
			beforeCalls,
			"plain and internal-pane gestures never become external opens",
		);
		await hover(gesture);
		await mouse("mousePressed", gesture);
		await mouse("mouseReleased", gesture);
		const events = await evaluate("window.__ownedUrlInputEvents");
		writeFileSync(
			join(output, `terminal-url-${phase}-input.json`),
			`${JSON.stringify({ gesture, point, events }, null, 2)}\n`,
		);
		assert.deepEqual(events.at(-1), {
			button: 0,
			ctrl: process.platform !== "darwin",
			meta: process.platform === "darwin",
			shift: true,
			alt: false,
		});
		let calls;
		calls = await until(async () => {
			const c = await observePortBrowserCalls();
			return c.length > beforeCalls.length ? c : null;
		}, "external URL gesture dispatched");
		assert.equal(calls.length, beforeCalls.length + 1);
		const opened = new URL(calls.at(-1).url);
		const expected = new URL(initial.url);
		if (!scope.localDevice) {
			assert.equal(opened.hostname, "127.0.0.1");
			expected.host = opened.host;
		}
		assert.equal(
			opened.href,
			expected.href,
			"protocol, path, query and fragment survive navigation",
		);
		const proof = await until(async () => {
			const p = await read();
			return requests(p) > requests(before) ? p : null;
		}, "actual browser reached the exact target path");
		const os = launches();
		assert.equal(new URL(os.at(-1).url).href, opened.href);
		await getPage().call("Page.bringToFront");
		await screenshot(`terminal-url-${phase}-opened`);
		const result = {
			phase,
			row,
			point,
			beforeCalls,
			calls,
			openedUrl: opened.href,
			proof,
			browserLaunches: os.length,
		};
		writeFileSync(
			join(output, `terminal-url-${phase}.json`),
			`${JSON.stringify(result, null, 2)}\n`,
		);
		return result;
	};
	report.urlFirst = await run("raw", 0);
	await closeReopen();
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
			),
		"same URL terminal after normal reopen",
	);
	const retained = await controls.inspectPresetTerminal(terminal.id);
	assert.equal(retained.pid, execution.pid);
	assert.equal(retained.executionId, execution.executionId);
	report.retained = retained;
	report.urlReopened = await run("osc8-reopened", 1);
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
	report.errors = getPage().errors;
	assert.deepEqual(report.errors, []);
}
