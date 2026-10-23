import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationMultiplePortsUi(options, context) {
	const {
		getPage,
		click,
		screenshot,
		controls,
		closeReopen,
		readClipboardText,
		setClipboard,
		output,
		observePortBrowserCalls,
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
	const urls = [];
	const result = { ports: initial.ports, phases: [] };
	report.multiplePorts = result;
	const save = () =>
		writeFileSync(
			join(output, "multiple-ports-ui.json"),
			`${JSON.stringify(result, null, 2)}\n`,
		);
	const request = async (url) => {
		const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
		assert.equal(response.status, 200);
		assert.equal(await response.text(), initial.marker);
		return { url, status: 200, marker: initial.marker };
	};
	const copy = async (port) => {
		await setClipboard({ text: "MULTI-COPY-SENTINEL" });
		const row = `[data-workspace-ports] [data-port="${port}"]`;
		await until(
			() =>
				evaluate(
					`Boolean(document.querySelector(${JSON.stringify(row)}+' button[aria-label="Copy localhost:${port}"]'))`,
				),
			"owned service copy row",
		);
		await click(`${row} button[aria-label="Copy localhost:${port}"]`);
		const url = await until(async () => {
			const text = await readClipboardText();
			return text.startsWith("http://127.0.0.1:") ? text : null;
		}, "local clipboard after port copy");
		await until(
			() =>
				evaluate(
					`[...document.querySelectorAll('[role=menu] code.text-xs')].some(e=>e.textContent===${JSON.stringify(url)})`,
				),
			"copied URL displayed",
		);
		urls.push(url);
		return url;
	};
	const openMenu = async () => {
		await click("text:Port");
		await until(
			() =>
				evaluate(`Boolean(document.querySelector('[data-workspace-ports]'))`),
			"own ports menu",
		);
	};
	const close = async (port, url) => {
		const button = `[data-forward-port="${port}"] button`;
		await click(button);
		await until(
			() =>
				evaluate(`!document.querySelector('[data-forward-port="${port}"]')`),
			"selected forward removed",
		);
		await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
	};
	try {
		assert.equal(initial.ports.length, 2);
		await click(
			`button.ws-workspace-card[aria-label=${JSON.stringify(workspace.name)}]`,
		);
		await until(
			() =>
				evaluate(
					`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
				),
			"original dual-service terminal",
		);
		await openMenu();
		for (const phase of ["first", "reopened"]) {
			const first = await copy(initial.ports[0]);
			await request(first);
			const second = await copy(initial.ports[1]);
			const observations = await Promise.allSettled([
				request(first),
				request(second),
			]);
			const observed = observations.map((record) =>
				record.status === "rejected"
					? {
							status: record.status,
							message: String(record.reason),
							code: record.reason?.cause?.code,
						}
					: record,
			);
			const rows = await evaluate(
				`[...document.querySelectorAll('[role=menu] code.text-xs')].map(e=>e.textContent)`,
			);
			result.phases.push({ phase, first, second, rows, observed });
			save();
			await screenshot(`ports-multiple-${phase}-copied`);
			assert.ok(
				observed.every((r) => r.status === "fulfilled"),
				"both copied addresses remain usable together",
			);
			assert.ok(
				rows.includes(first) && rows.includes(second),
				"both forward controls remain visible",
			);
			const repeated = await copy(initial.ports[1]);
			assert.equal(repeated, second);
			assert.equal(
				await evaluate(
					`document.querySelectorAll('[data-forward-port="${initial.ports[1]}"]').length`,
				),
				1,
			);
			await close(initial.ports[0], first);
			await request(second);
			await screenshot(`ports-multiple-${phase}-one-closed`);
			if (phase !== "first") await close(initial.ports[1], second);
			assert.equal((await read()).running, true);
			result.phases.at(-1).errors = [...getPage().errors];
			assert.deepEqual(result.phases.at(-1).errors, []);
			if (phase === "first") {
				for (const type of ["keyDown", "keyUp"])
					await getPage().call("Input.dispatchKeyEvent", {
						type,
						key: "Escape",
						code: "Escape",
						windowsVirtualKeyCode: 27,
					});
				await until(
					() => evaluate(`!document.querySelector('[role=menu]')`),
					"menu closed before dual-forward reopen",
				);
				await closeReopen();
				await assert.rejects(
					fetch(second, { signal: AbortSignal.timeout(1000) }),
				);
				await until(
					() =>
						evaluate(
							`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
						),
					"same original service after reopening",
				);
				await openMenu();
			}
		}
		const retained = await controls.inspectPresetTerminal(terminal.id);
		assert.equal(retained.pid, execution.pid);
		assert.equal(retained.executionId, execution.executionId);
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
		}
		result.retained = retained;
		result.calls = await observePortBrowserCalls();
		assert.deepEqual(result.calls, []);
		result.errors = getPage().errors;
		assert.deepEqual(result.errors, []);
		result.finished = true;
	} finally {
		save();
	}
}
