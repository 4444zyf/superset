import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationTerminalAttachInputUi(options) {
	const { getPage, click, screenshot, output, controls, closeReopen } = options;
	const { evaluate, until } = agentUiDriver(options);
	const scope = await evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);return {connectionId:d.connectionId,backendId:d.backendId,namespaceId:d.namespaceId,workspaceId:w.workspaceId,terminals:w.panes.filter(p=>p.kind==='terminal').map(p=>p.resourceId)};})()`);
	const query = (path, input) => evaluate(`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)}||d.backendId!==${JSON.stringify(scope.backendId)}||d.namespaceId!==${JSON.stringify(scope.namespaceId)})throw Error('Scope changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`);
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const originals = await Promise.all(scope.terminals.map(async (id) => {
		const row = await controls.inspectPresetTerminal(id);
		return { id, pid: row.pid, executionId: row.executionId, cwd: row.cwd };
	}));
	await click("text:New terminal");
	const terminal = await until(() => evaluate(`[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,state:e.dataset.restoreState})).find(e=>e.state==='attached'&&!${JSON.stringify(scope.terminals)}.includes(e.id))`), "input fixture attached");
	const selector = `[data-terminal-id="${terminal.id}"]`;
	const execution = await controls.inspectPresetTerminal(terminal.id);
	const file = `terminal-attach-${randomUUID()}.txt`;
	const read = async () => {
		const result = await query("filesystem.readFile", { workspaceId: scope.workspaceId, absolutePath: `${workspace.worktreePath}/${file}`, maxBytes: 4096 });
		return result.kind === "bytes" ? Buffer.from(result.content, "base64").toString() : result.content;
	};
	const phases = [];
	let expected = "";
	for (const phase of ["first", "after-reopen"]) {
		await click("text:Files");
		await until(() => evaluate(`Boolean(document.querySelector('[data-workspace-files]'))`), "files tool before remount");
		const paused = controls.pauseOwnedBackend();
		const started = performance.now();
		let focused;
		let heldMs;
		try {
			await click("text:Terminal");
			await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="pending"] .xterm-screen'))`), "terminal awaits the paused backend");
			await getPage().call("Page.bringToFront");
			await click(`${selector} .xterm-screen`);
			focused = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {state:e?.dataset.restoreState,active:e?.closest('[data-active]')?.getAttribute('data-active'),focused:Boolean(e?.contains(document.activeElement)&&document.activeElement?.matches('textarea'))};})()`);
			assert.deepEqual(focused, { state: "pending", active: "true", focused: true });
			await getPage().call("Input.insertText", { text: `printf '%s\\n' 'queued 中文 🙂 ${phase}' >> ${file}` });
			for (const type of ["keyDown", "keyUp"]) await getPage().call("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
			await screenshot(`terminal-attach-input-pending-${phase}`);
			assert.ok(performance.now() - started < 4500, "native input must stay within the product queue lifetime");
		} finally {
			heldMs = performance.now() - started;
			paused.resume();
		}
		await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`), "same terminal attached after backend resumes");
		expected += `queued 中文 🙂 ${phase}\n`;
		let actual;
		try {
			actual = await until(async () => { try { const text = await read(); return text === expected ? text : null; } catch { return null; } }, "queued native command reaches the original PTY exactly once");
		} finally {
			const observed = await controls.inspectPresetTerminal(terminal.id);
			writeFileSync(join(output, `terminal-attach-input-${phase}.json`), JSON.stringify({ pausedBackendPid: paused.pid, backendPausedMs: heldMs, elapsedMs: performance.now() - started, focused, observed, expected, actual, sourceRevision: process.env.GITHUB_SHA }, null, 2) + "\n");
		}
		await screenshot(`terminal-attach-input-complete-${phase}`);
		phases.push({ phase, actual, pid: execution.pid, executionId: execution.executionId });
		await closeReopen();
		await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`), "input fixture after normal reopen");
		assert.equal(await read(), expected, "normal reopen cannot resend the queued command");
	}
	const retained = await controls.inspectPresetTerminal(terminal.id);
	assert.equal(retained.pid, execution.pid);
	assert.equal(retained.executionId, execution.executionId);
	for (const original of originals) {
		const row = await controls.inspectPresetTerminal(original.id);
		assert.deepEqual({ id: row.id, pid: row.pid, executionId: row.executionId, cwd: row.cwd }, original);
	}
	assert.deepEqual(getPage().errors, []);
	writeFileSync(join(output, "terminal-attach-input-ui.json"), JSON.stringify({ scope, originals, execution, retained, phases, expected, sourceRevision: process.env.GITHUB_SHA, errors: getPage().errors }, null, 2) + "\n");
}
