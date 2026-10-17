import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationTerminalPresetsUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	controls,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		for (let i = 0; i < 200; i++) {
			const value = await read();
			if (value) return value;
			await delay(50);
		}
		await screenshot("terminal-presets-failure");
		throw new Error("Terminal preset UI condition failed");
	};
	const descriptor = await evaluate(
		"(async()=> (await window.directWorkstation.getWorkspaceRestore()).descriptor)()",
	);
	const view = () => evaluate("window.directWorkstation.getWorkspaceView()");
	const selected = async () => {
		const snapshot = (await view()).snapshot;
		const target = snapshot.targets.find(
			(t) => t.connectionId === descriptor.connectionId,
		);
		return target.workspaces.find((w) => w.tabId === target.activeTabId);
	};
	const workspaceId = (await selected()).workspaceId;
	const query = (path, input) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(descriptor.connectionId)})throw new Error('Unexpected preset target');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const workspace = await query("workspace.get", { id: workspaceId });
	const original = await controls.verifyWorktreeLocation(
		workspace.worktreePath,
	);
	// Configure only the owned fixture's Codex catalog entry to a deterministic shell probe.
	await query("settings.agentConfigs.list", undefined);
	const fixture = await controls.prepareTerminalPreset(workspace.worktreePath);
	await click("[data-workstation-presets] > button:last-of-type");
	await until(() =>
		evaluate(
			`Boolean([...document.querySelectorAll('[data-workstation-presets] button')].find(e=>e.textContent.trim()===${JSON.stringify(fixture.label)}))`,
		),
	);
	const runsPath = join(workspace.worktreePath, "preset-runs.txt"),
		cwdPath = join(workspace.worktreePath, "preset-cwd.txt");
	assert.equal(existsSync(runsPath), false);
	await screenshot("terminal-presets-original-button-before-launch");
	await click(`text:${fixture.label}`);
	const runs = () =>
		existsSync(runsPath)
			? readFileSync(runsPath, "utf8").split("\n").filter(Boolean)
			: [];
	await until(() => runs().length === 1);
	await until(async () => (await selected()).panes.length === 4);
	const firstPane = (await selected()).panes.find(
		(p) => p.label === fixture.label,
	);
	assert.ok(firstPane);
	const first = await until(async () => {
		const row = await controls.inspectPresetTerminal(firstPane.resourceId);
		return row.output.includes("preset execution done") ? row : null;
	});
	assert.equal(first.cwd, workspace.worktreePath);
	assert.ok(first.output.includes("preset execution done"));
	await screenshot("terminal-presets-explicit-button-ran-on-ssh");
	await click("text:Agents");
	await until(() => evaluate("Boolean(document.querySelector('[role=menu]'))"));
	await click(`menu:${fixture.label}`);
	await until(() => runs().length === 2);
	await until(async () => (await selected()).panes.length === 5);
	const panes = (await selected()).panes.filter(
		(p) => p.label === fixture.label,
	);
	assert.equal(panes.length, 2);
	const spawned = await Promise.all(
		panes.map((p) => controls.inspectPresetTerminal(p.resourceId)),
	);
	assert.equal(new Set(spawned.map((p) => p.pid)).size, 2);
	assert.deepEqual(runs(), ["preset 中文 🙂", "preset 中文 🙂"]);
	assert.deepEqual(readFileSync(cwdPath, "utf8").split("\n").filter(Boolean), [
		workspace.worktreePath,
		workspace.worktreePath,
	]);
	await screenshot("terminal-presets-explicit-menu-ran-on-ssh");
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(descriptor.connectionId)};})()`,
		),
	);
	await until(
		async () =>
			(await selected()).panes.filter((p) => p.label === fixture.label)
				.length === 2,
	);
	assert.deepEqual(runs(), ["preset 中文 🙂", "preset 中文 🙂"]);
	const reopened = await Promise.all(
		panes.map((p) => controls.inspectPresetTerminal(p.resourceId)),
	);
	assert.deepEqual(
		reopened.map((p) => ({
			id: p.id,
			executionId: p.executionId,
			pid: p.pid,
			cwd: p.cwd,
		})),
		spawned.map((p) => ({
			id: p.id,
			executionId: p.executionId,
			pid: p.pid,
			cwd: p.cwd,
		})),
	);
	assert.deepEqual(
		await controls.verifyWorktreeLocation(workspace.worktreePath),
		original,
	);
	assert.deepEqual(getPage().errors, []);
	await screenshot("terminal-presets-reopened-without-relaunch");
	writeFileSync(
		join(output, "workstation-terminal-presets-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				workspaceId,
				originalTerminals: original.terminals,
				spawned: reopened.map((p) => ({
					id: p.id,
					executionId: p.executionId,
					pid: p.pid,
					cwd: p.cwd,
				})),
				explicitRuns: runs(),
				originalCommandBuilder: true,
				fixtureCatalogConfiguredViaOwnedDatabase: true,
				vendorAgentVerified: false,
				macOSVerified: false,
				noAutomaticRelaunch: true,
			},
			null,
			2,
		) + "\n",
	);
}
