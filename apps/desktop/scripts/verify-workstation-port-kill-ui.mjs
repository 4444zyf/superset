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
	const bulk = process.argv.includes("--port-bulk");
	const closeAction = bulk
		? "[data-workspace-ports] [data-port-footer] button"
		: `${row} button[aria-label="Close port ${initial.port}"]`;
	const expectedPorts = bulk ? initial.ports : [initial.port];
	assert.ok(Array.isArray(expectedPorts) && expectedPorts.length > 0);
	const protectedPorts = [];
	const confirmationTitle = bulk
		? "These ports are still in use"
		: "This port is still in use";
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
				`Boolean(document.querySelector(${JSON.stringify(closeAction)}))`,
			),
		"original port close action",
	);
	if (bulk) {
		await until(
			() =>
				evaluate(
					`${JSON.stringify(expectedPorts)}.every(port=>document.querySelector('[data-workspace-ports] [data-port="'+port+'"]'))`,
				),
			"both owned service ports discovered",
		);
		const observed = await controls.inspectWorkspacePorts(
			report.scope.workspaceId,
		);
		for (const port of observed) {
			if (expectedPorts.includes(port.port)) {
				assert.equal(port.pid, initial.pid);
				assert.equal(port.terminalId, terminal.id);
			} else {
				assert.equal(port.processName, "bash");
				assert.ok(
					originals.some(
						(original) =>
							original.id === port.terminalId && original.pid === port.pid,
					),
					"bulk test may only target the owned original shells and server",
				);
				protectedPorts.push(port);
			}
		}
		assert.ok(
			expectedPorts.every((port) => observed.some((p) => p.port === port)),
		);
	}
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
	await click(closeAction);
	await until(
		() =>
			evaluate(
				`document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(confirmationTitle)})`,
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
	const cancelledBody = await (await fetch(url)).text();
	assert.equal(cancelledBody, initial.marker);
	report.cancelledPortClose = {
		running: true,
		url,
		body: cancelledBody,
		port: initial.port,
	};
	await screenshot("ports-service-close-cancelled");
	if (!(await evaluate(`Boolean(document.querySelector('[role=menu]'))`)))
		await click("text:Port");
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector(${JSON.stringify(closeAction)}))`,
			),
		"close row after cancellation",
	);
	await click(closeAction);
	await until(
		() =>
			evaluate(
				`document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(confirmationTitle)})`,
			),
		"close confirmation after cancellation",
	);
	await click(bulk ? "text:Close ports" : "text:Close port");
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
				`(()=>{const root=document.querySelector('[data-workspace-ports]');return root&&!root.innerText.includes('Loading...')&&root.querySelector('button')?.getAttribute('aria-busy')!=='true'&&!${JSON.stringify(expectedPorts)}.some(port=>root.querySelector('[data-port="'+port+'"]'));})()`,
			),
		"closed service row removed after completed read",
	);
	const closeAlerts = await evaluate(
		`Array.from(document.querySelectorAll('[data-workspace-ports] [role=alert]'),e=>e.textContent)`,
	);
	if (protectedPorts.length) {
		assert.equal(closeAlerts.length, 1);
		assert.ok(
			closeAlerts[0].includes("Cannot kill the terminal shell process"),
		);
		if (bulk)
			assert.ok(
				closeAlerts[0].startsWith(
					`Failed to close ${protectedPorts.length} ${protectedPorts.length === 1 ? "port" : "ports"}`,
				),
			);
	} else assert.deepEqual(closeAlerts, []);
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
		bulk,
		expectedPorts,
		protectedPorts,
		closeAlerts,
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
		`${JSON.stringify(report.killed, null, 2)}\n`,
	);
}
