import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationPortKillUi(options, context) {
	const {
		click,
		getPage,
		output,
		screenshot,
		controls,
		readClipboardText,
		setClipboard,
	} = options;
	const {
		initial,
		workspace,
		terminal,
		execution,
		originals,
		selector,
		read,
		report,
	} = context;
	const { evaluate, until } = agentUiDriver(options);
	const row = `[data-workspace-ports] [data-port="${initial.port}"]`;
	await click(
		`button.ws-workspace-card[aria-label=${JSON.stringify(workspace.name)}]`,
	);
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
			),
		"same terminal before closing owned service",
	);
	await click("text:Port");
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector(${JSON.stringify(row)}+' button[aria-label="Close port ${initial.port}"]'))`,
			),
		"original port close action",
	);
	await setClipboard({ text: "KILL-COPY-SENTINEL" });
	await click(`${row} button[aria-label="Copy localhost:${initial.port}"]`);
	const url = await until(async () => {
		const value = await readClipboardText();
		return value.startsWith("http://127.0.0.1:") ? value : null;
	}, "live copied address before service close");
	await until(
		() =>
			evaluate(
				`document.querySelector('[role=menu] code.text-xs')?.textContent===${JSON.stringify(url)}`,
			),
		"live copy forward displayed before service close",
	);
	const before = await fetch(url);
	assert.equal(await before.text(), initial.marker);
	await screenshot("ports-before-service-close");
	await click(`${row} button[aria-label="Close port ${initial.port}"]`);
	await until(
		() =>
			evaluate(
				`document.querySelector('[role=dialog]')?.textContent.includes('This port is still in use')`,
			),
		"original close confirmation",
	);
	await screenshot("ports-service-close-cancel");
	await click("text:Cancel");
	await until(
		() => evaluate(`!document.querySelector('[role=dialog]')`),
		"port close cancelled",
	);
	assert.equal((await read()).running, true);
	assert.equal(await (await fetch(url)).text(), initial.marker);
	if (!(await evaluate(`Boolean(document.querySelector('[role=menu]'))`)))
		await click("text:Port");
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector(${JSON.stringify(row)}+' button[aria-label="Close port ${initial.port}"]'))`,
			),
		"close row after cancellation",
	);
	await click(`${row} button[aria-label="Close port ${initial.port}"]`);
	await until(
		() =>
			evaluate(
				`document.querySelector('[role=dialog]')?.textContent.includes('This port is still in use')`,
			),
		"close confirmation after cancellation",
	);
	await click("text:Close port");
	await until(
		() => evaluate(`!document.querySelector('[role=dialog]')`),
		"close confirmation accepted",
	);
	if (!(await evaluate(`Boolean(document.querySelector('[role=menu]'))`)))
		await click("text:Port");
	const stopped = await until(async () => {
		const value = await read();
		return value.running === false ? value : null;
	}, "owned server stopped through original port kill");
	await until(
		() =>
			evaluate(
				`(()=>{const root=document.querySelector('[data-workspace-ports]');return root&&!root.querySelector('[role=alert]')&&!root.innerText.includes('Loading...')&&root.querySelector('button')?.getAttribute('aria-busy')!=='true'&&!root.querySelector('[data-port="${initial.port}"]');})()`,
			),
		"closed service row removed after completed read",
	);
	await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
	const retained = await controls.inspectPresetTerminal(terminal.id);
	assert.equal(retained.alive, true);
	assert.equal(retained.pid, execution.pid);
	assert.equal(retained.executionId, execution.executionId);
	assert.deepEqual(getPage().errors, []);
	const retainedOriginals = [];
	for (const original of originals) {
		const current = await controls.inspectPresetTerminal(original.id);
		assert.equal(current.alive, true);
		assert.deepEqual(
			{
				id: current.id,
				pid: current.pid,
				executionId: current.executionId,
				cwd: current.cwd,
			},
			original,
		);
		retainedOriginals.push({
			id: current.id,
			pid: current.pid,
			executionId: current.executionId,
			cwd: current.cwd,
		});
	}
	report.killed = {
		retainedOriginals,
		port: initial.port,
		serverPid: initial.pid,
		url,
		stopped,
		retained,
		errors: getPage().errors,
	};
	await screenshot("ports-after-service-close");
	const close = await evaluate(
		`(()=>{const e=document.querySelector('[role=menu] code.text-xs')?.parentElement?.querySelector('button'),r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
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
		"closed service forward released separately",
	);
	writeFileSync(
		join(output, "port-kill-ui.json"),
		JSON.stringify(report.killed, null, 2) + "\n",
	);
}
