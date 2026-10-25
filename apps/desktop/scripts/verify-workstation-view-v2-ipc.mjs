import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationViewV2Ipc(options) {
	const { output, scope, controls, restart, getPage, screenshot } = options;
	const { evaluate, until } = agentUiDriver(options);
	const report = {
		kind: "Native V2 layout IPC, guest registration and SQLite persistence; browser pane UI not exercised",
		descriptor: scope.d,
		available: await evaluate(
			"Boolean(window.directWorkstation.getWorkspaceViewV2 && window.directWorkstation.saveWorkspaceViewV2 && window.directWorkstation.browser?.updatePage)",
		),
	};
	const save = () =>
		writeFileSync(
			join(output, "workspace-view-v2-ipc.json"),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	save();
	assert.equal(
		report.available,
		true,
		"V2 layout and registered page metadata IPC is available",
	);
	const read = () => evaluate("window.directWorkstation.getWorkspaceViewV2()");
	let current;
	await until(async () => {
		current = await read();
		return current.snapshot?.targets.some(
			(t) =>
				t.connectionId === scope.d.connectionId &&
				t.workspaces.some(
					(w) =>
						w.workspaceId === scope.w.workspaceId &&
						w.panes.some((p) => p.kind === "terminal"),
				),
		);
	}, "terminal layout persisted");
	const original = current.snapshot.targets
		.find((t) => t.connectionId === scope.d.connectionId)
		.workspaces.find((w) => w.workspaceId === scope.w.workspaceId);
	const terminal = original.panes.find((p) => p.kind === "terminal");
	const run = {
		terminalId: terminal.resourceId,
		executionId: terminal.executionId,
	};
	report.terminalBefore = await controls.inspectRunExecution(run);
	assert.equal(report.terminalBefore.alive, true);
	const { schemaVersion, revision, updatedAt, ...view } = current.snapshot;
	assert.equal(schemaVersion, 2);
	const workspace = view.targets
		.find((t) => t.connectionId === scope.d.connectionId)
		.workspaces.find((w) => w.workspaceId === scope.w.workspaceId);
	const paneId = randomUUID();
	const state = {
		url: "about:blank",
		pageTitle: "Owned browser",
		faviconUrl: null,
	};
	workspace.panes.push({
		paneId,
		resourceId: randomUUID(),
		kind: "browser",
		browser: state,
	});
	const browserLeaf = { type: "pane", paneId };
	workspace.layout = {
		type: "split",
		axis: "horizontal",
		ratio: 0.4,
		first: workspace.layout,
		second: browserLeaf,
	};
	if (workspace.paneTabs) {
		const active = workspace.paneTabs.find(
			(t) => t.tabId === workspace.activePaneTabId,
		);
		assert.ok(active);
		active.layout = {
			type: "split",
			axis: "horizontal",
			ratio: 0.4,
			first: active.layout,
			second: browserLeaf,
		};
		active.activePaneId = paneId;
	}
	workspace.activePaneId = paneId;
	const saved = await evaluate(
		`window.directWorkstation.saveWorkspaceViewV2(${JSON.stringify({ expectedRevision: revision, navigationRevision: current.navigationRevision, view, browserLeases: [{ connectionId: scope.d.connectionId, generation: scope.d.generation }] })})`,
	);
	assert.equal(saved.schemaVersion, 2);
	const browser = (value) =>
		value.targets
			.find((t) => t.connectionId === scope.d.connectionId)
			.workspaces.find((w) => w.workspaceId === scope.w.workspaceId)
			.panes.find((p) => p.paneId === paneId);
	assert.deepEqual(browser(saved).browser, state);
	const legacy = await evaluate("window.directWorkstation.getWorkspaceView()");
	assert.equal(legacy.snapshot.schemaVersion, 1);
	assert.equal(
		legacy.snapshot.targets
			.flatMap((t) => t.workspaces.flatMap((w) => w.panes))
			.some((p) => p.kind === "browser"),
		false,
	);
	const registration = {
		connectionId: scope.d.connectionId,
		generation: scope.d.generation,
		workspaceId: scope.w.workspaceId,
		paneId,
		registrationId: randomUUID(),
	};
	const webContentsId = await evaluate(
		`new Promise((resolve,reject)=>{const v=document.createElement('webview');v.id='owned-v2-diagnostic-guest';v.setAttribute('partition','persist:superset');v.style.cssText='position:fixed;left:-1000px;top:0;width:320px;height:200px';v.addEventListener('dom-ready',()=>resolve(v.getWebContentsId()),{once:true});v.addEventListener('did-fail-load',e=>reject(Error(e.errorDescription)),{once:true});v.src='about:blank';document.body.append(v);})`,
	);
	await evaluate(
		`window.directWorkstation.browser.register(${JSON.stringify({ ...registration, webContentsId })})`,
	);
	const nextState = {
		url: "https://owned.invalid/中文?literal='quote'#part",
		pageTitle: "已保存 🙂",
		faviconUrl: null,
	};
	const updated = await evaluate(
		`window.directWorkstation.browser.updatePage(${JSON.stringify({ pane: registration, state: nextState })})`,
	);
	assert.equal(updated.status, "saved");
	assert.deepEqual(browser(updated.snapshot).browser, nextState);
	assert.equal(
		(
			await evaluate(
				`window.directWorkstation.browser.updatePage(${JSON.stringify({ pane: registration, state: nextState })})`,
			)
		).status,
		"unchanged",
	);
	await evaluate(
		`window.directWorkstation.browser.unregister(${JSON.stringify(registration)})`,
	);
	await evaluate(
		"document.querySelector('#owned-v2-diagnostic-guest').remove();true",
	);
	const stale = await evaluate(
		`window.directWorkstation.browser.updatePage(${JSON.stringify({ pane: registration, state: { ...nextState, pageTitle: "STALE CALLBACK" } })})`,
	);
	assert.deepEqual(stale, { status: "stale" });
	assert.deepEqual(browser((await read()).snapshot).browser, nextState);
	report.savedPage = nextState;
	report.stale = stale;
	report.savedRevision = updated.snapshot.revision;
	await screenshot("v2-backend-terminal-before-reopen");
	save();
	await restart();
	await until(
		() => evaluate("Boolean(window.directWorkstation)"),
		"reopened renderer",
	);
	const reopened = await read();
	assert.equal(reopened.invalid, false);
	assert.deepEqual(browser(reopened.snapshot).browser, nextState);
	report.reopenedRevision = reopened.revision;
	report.terminalAfter = await controls.inspectRunExecution(
		run,
		report.terminalBefore.pid,
	);
	assert.equal(report.terminalAfter.alive, true);
	assert.equal(
		report.terminalAfter.executionId,
		report.terminalBefore.executionId,
	);
	assert.equal(report.terminalAfter.cwd, report.terminalBefore.cwd);
	assert.deepEqual(getPage().errors, []);
	report.rendererErrors = getPage().errors;
	save();
	await screenshot("v2-backend-terminal-after-reopen");
}
