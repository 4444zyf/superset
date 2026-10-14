import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { verifyWorkstationFileGitUi } from "./verify-workstation-file-git-ui.mjs";
import { verifyWorkstationSettingsUi } from "./verify-workstation-settings-ui.mjs";

export async function verifyWorkspaceRestoreUi({
	getPage,
	click,
	screenshot,
	restart,
	closeReopen,
	controls,
	output,
	samples = 20,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let i = 0; i < 200; i++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error(
			`Window restore did not become ready: ${await evaluate("document.body.innerText.slice(-2400)")}`,
		);
	};
	const type = async (selector, text) => {
		await click(selector);
		await getPage().call("Input.insertText", { text });
	};
	const saved = () => evaluate("window.directWorkstation.getWorkspaceView()");
	const terminals = () =>
		evaluate(
			"[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,executionId:e.dataset.executionId,state:e.dataset.restoreState}))",
		);
	const ready = () =>
		until(
			terminals,
			(rows) => rows.length === 3 && rows.every((r) => r.state === "attached"),
		);
	await click('[data-slot=sidebar-content] button[aria-label="Workspaces"]');
	await click(".ws-heading-actions .primary");
	await type('[role="dialog"] input', "Restore lifecycle");
	await click('[role="dialog"] button[type="submit"]');
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await until(() =>
		evaluate("Boolean(document.querySelector('.ws-workspace-window'))"),
	);
	await click("text:New terminal");
	await until(
		terminals,
		(rows) => rows.length === 1 && rows[0].state === "attached",
	);
	await click('button[aria-label="Split horizontally"]');
	await until(
		terminals,
		(rows) => rows.length === 2 && rows.every((r) => r.state === "attached"),
	);
	await click('button[aria-label="Split vertically"]');
	const original = await ready();
	controls?.trackOriginals(original);
	await click("[data-terminal-id] .xterm-screen");
	await getPage().call("Input.insertText", {
		text: "printf 'before\\r\\n' > restore-ui.txt",
	});
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await click("text:Files");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='restore-ui.txt' && !b.disabled)",
		),
	);
	await click("text:restore-ui.txt");
	await until(() => evaluate("Boolean(document.querySelector('.cm-content'))"));
	await click(".cm-content");
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "a",
		code: "KeyA",
		windowsVirtualKeyCode: 65,
		modifiers: process.platform === "darwin" ? 4 : 2,
		commands: ["selectAll"],
	});
	await getPage().call("Input.insertText", { text: "after upstream editor" });
	await click("text:Save file");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save file')?.disabled",
		),
	);
	await click("text:Close file and discard draft");
	await click("text:restore-ui.txt");
	await until(() =>
		evaluate(
			"document.querySelector('.cm-content')?.textContent==='after upstream editor'",
		),
	);
	await screenshot("upstream-remote-code-editor");
	await click("text:Terminal");
	await ready();
	await click("[data-terminal-id] .xterm-screen");
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "f",
		code: "KeyF",
		windowsVirtualKeyCode: 70,
		modifiers: process.platform === "darwin" ? 4 : 2,
	});
	await until(() =>
		evaluate("Boolean(document.querySelector('input[placeholder=Find]'))"),
	);
	await getPage().call("Input.insertText", { text: "restore-ui.txt" });
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await until(() =>
		evaluate("!document.querySelector('input[placeholder=Find]')"),
	);
	await click('button[aria-label="Toggle sidebar"]');
	await screenshot("upstream-collapsed-sidebar");
	await click('button[aria-label="Toggle sidebar"]');

	for (let i = 0; i < 3; i++) {
		const paneId = await evaluate(
			`[...document.querySelectorAll('.ws-workspace-pane')][${i}].dataset.paneId`,
		);
		const base = `[data-pane-id="${paneId}"]`;
		await click(`[data-pane-title-id="${paneId}"]`);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
		});
		await getPage().call("Input.insertText", {
			text: ["Claude", "Codex", "OMP"][i],
		});
		await click(`${base} .xterm-screen`);
		await getPage().call("Input.insertText", {
			text: `while :; do printf 'RESTORE_${i} %s\\n' "$$"; sleep 0.3; done`,
		});
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
	}
	const beforeDrag = JSON.stringify(
		(await saved()).snapshot.targets[0].workspaces[0].layout,
	);
	const dragPoints = await evaluate(
		`(() => {const titles=[...document.querySelectorAll('[data-pane-title-id]')];const source=titles[2].closest('.cursor-grab').getBoundingClientRect();const target=document.querySelector('[data-pane-id="'+titles[0].dataset.paneTitleId+'"]').getBoundingClientRect();return {start:{x:source.x+10,y:source.y+source.height/2},end:{x:target.x+target.width/2,y:target.bottom-30}};})()`,
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...dragPoints.start,
	});
	for (let step = 1; step <= 12; step++) {
		await getPage().call("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
			buttons: 1,
			x:
				dragPoints.start.x +
				((dragPoints.end.x - dragPoints.start.x) * step) / 12,
			y:
				dragPoints.start.y +
				((dragPoints.end.y - dragPoints.start.y) * step) / 12,
		});
		await delay(20);
	}
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		...dragPoints.end,
	});
	await until(
		saved,
		(v) =>
			JSON.stringify(v.snapshot.targets[0].workspaces[0].layout) !== beforeDrag,
	);
	const afterDrag = await ready();
	assert.deepEqual(
		afterDrag.map((r) => r.id).sort(),
		original.map((r) => r.id).sort(),
	);
	original.splice(0, original.length, ...afterDrag);
	const firstDivider = await evaluate(
		"(() => {const split=document.querySelector('[data-panel-group-direction=horizontal]');const divider=split.querySelector(':scope > [data-slot=resizable-handle]');const r=split.getBoundingClientRect(),d=divider.getBoundingClientRect();return {start:{x:d.x+d.width/2,y:d.y+d.height/2},end:{x:r.x+r.width*.37,y:d.y+d.height/2}};})()",
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...firstDivider.start,
	});
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		button: "left",
		buttons: 1,
		...firstDivider.end,
	});
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		...firstDivider.end,
	});
	await until(
		saved,
		(v) =>
			Math.abs(
				(v.snapshot?.targets[0]?.workspaces[0]?.layout?.ratio ?? 0) - 0.37,
			) < 0.02 &&
			v.snapshot.targets[0].workspaces[0].panes.every((p) => p.label),
	);
	const before = (await saved()).snapshot.targets[0];
	const strictHeaderAuth = controls
		? await controls.verifyHeaderOnly({
				workspaceId: before.workspaces[0].workspaceId,
				...before.workspaces[0].panes[0],
				resourceId: before.workspaces[0].panes[0].resourceId,
			})
		: undefined;
	assert.deepEqual(
		before.workspaces[0].panes.map((p) => p.label),
		["Claude", "Codex", "OMP"],
	);
	await screenshot("restore-three-panes-before");
	const report = {
		source: process.env.GITHUB_SHA,
		arch: process.arch,
		platform: process.platform,
		realInput: true,
		upstreamCodeEditorReadWrite: true,
		upstreamTerminalSearch: true,
		upstreamSidebarCollapse: true,
		upstreamPaneDrag: true,
		heartbeatPtyOnly: true,
		strictHeaderAuth,
		original,
		samples: [],
	};
	for (let i = 0; i < samples; i++) {
		const closedHeartbeat = await restart(i === 1 ? "force" : "quit");
		const rows = await ready();
		assert.deepEqual(
			rows.map(({ id, executionId }) => ({ id, executionId })),
			original.map(({ id, executionId }) => ({ id, executionId })),
		);
		const restored = (await saved()).snapshot.targets[0];
		assert.deepEqual(restored.workspaces, before.workspaces);
		const timing = await evaluate(
			`(async () => { const job=await window.directWorkstation.getWorkspaceRestore(); const marks=performance.getEntriesByName('workspace-layout-visible'); const initial=performance.getEntriesByName('workspace-renderer-ready'); return { skeletonMs:marks[0]?.startTime-initial[0]?.startTime, authenticatedToAttachedUpperBoundMs:performance.timeOrigin+performance.now()-job.authenticatedAt }; })()`,
		);
		report.samples.push({
			closedHeartbeat,
			lifecycle: i === 1 ? "forceQuit" : "quit",
			...timing,
		});
		assert.deepEqual(getPage().errors, []);
		if (i < 2)
			await screenshot(`restore-${i === 1 ? "force-quit" : "normal-quit"}`);
		writeFileSync(
			join(output, "workspace-restore-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	}
	await click("text:Files");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='restore-ui.txt' && !b.disabled)",
		),
	);
	await click("text:restore-ui.txt");
	await until(() => evaluate("Boolean(document.querySelector('.cm-content'))"));
	await verifyWorkstationFileGitUi({ getPage, click, screenshot, output });
	await click("text:Terminal");
	await ready();
	await verifyWorkstationSettingsUi({
		getPage,
		click,
		screenshot,
		closeReopen,
		ready,
		output,
	});
	await until(
		saved,
		(value) =>
			JSON.stringify(value.snapshot.targets[0].workspaces) ===
			JSON.stringify(before.workspaces),
	);
	await closeReopen();
	await ready();
	assert.deepEqual(
		(await saved()).snapshot.targets[0].workspaces,
		before.workspaces,
	);
	report.windowClose = true;
	await screenshot("restore-window-close");
	const separator = await evaluate(
		"(() => { const r=document.querySelector('[data-slot=resizable-panel-group]').querySelector(':scope > [data-slot=resizable-handle]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()",
	);
	await evaluate(
		"window.restoreStall=setInterval(()=>{const end=performance.now()+120;while(performance.now()<end){}},400); true",
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...separator,
	});
	for (const delta of [-100, 100, -180, 180, -100, 100, 0]) {
		await getPage().call("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
			buttons: 1,
			x: separator.x + delta,
			y: separator.y,
		});
		await delay(150);
	}
	await delay(600);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		...separator,
	});
	await evaluate("clearInterval(window.restoreStall); true");
	assert.deepEqual(getPage().errors, []);
	report.resizeStress = true;
	await screenshot("restore-resize-stress");
	if (controls) {
		controls.trackOriginals([]);
		await click(
			'[data-slot=sidebar-content] button[aria-label="SSH machines"]',
		);
		await click(".ws-detail-actions button:last-child");
		await until(saved, (v) => v.snapshot.targets[0].autoConnect === false);
		await restart("quit");
		await until(
			() => evaluate("window.directWorkstation.getWorkspaceRestore()"),
			(j) => j?.status === "paused",
		);
		assert.equal(
			(await terminals()).some((t) => t.state === "attached"),
			false,
		);
		await click("text:Retry");
		await ready();
		assert.equal((await saved()).snapshot.targets[0].autoConnect, true);
		report.manualDisconnectThenRestore = true;
		await screenshot("restore-manual-disconnect-retry");
		await controls.setAvailable(false);
		await restart("quit");
		await until(
			() => evaluate("window.directWorkstation.getWorkspaceRestore()"),
			(j) => j?.status === "paused",
		);
		assert.equal(
			await evaluate("document.querySelectorAll('.ws-workspace-pane').length"),
			3,
		);
		assert.equal(
			(await terminals()).some((t) => t.state === "attached"),
			false,
		);
		await screenshot("restore-offline-preserved");
		await controls.setAvailable(true);
		await click("text:Retry");
		await ready();
		report.offline = true;
		report.hostRestart = await controls.restartHost();
		await restart("quit");
		const rows = await ready();
		assert.deepEqual(
			rows.map(({ id, executionId }) => ({ id, executionId })),
			original.map(({ id, executionId }) => ({ id, executionId })),
		);
		await screenshot("restore-host-restart-same-executions");
		const endId = await evaluate(
			"[...document.querySelectorAll('.ws-workspace-pane')].at(-1).dataset.paneId",
		);
		await click(`[data-pane-id="${endId}"] .xterm-screen`);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "c",
			code: "KeyC",
			windowsVirtualKeyCode: 67,
			modifiers: 2,
		});
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "c",
			code: "KeyC",
			windowsVirtualKeyCode: 67,
			modifiers: 2,
		});
		await getPage().call("Input.insertText", { text: "exit" });
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await until(() =>
			evaluate(
				"document.querySelectorAll('[data-resource-state=exited]').length",
			),
		);
		await restart("quit");
		await until(
			terminals,
			(rs) => rs.length === 2 && rs.every((r) => r.state === "attached"),
		);
		assert.equal(
			await evaluate("document.querySelectorAll('.ws-workspace-pane').length"),
			3,
		);
		report.partialEnded = true;
		await screenshot("restore-one-ended-two-live");
		for (const name of ["Second workspace", "Third workspace"]) {
			await click(
				".ws-workspace-window .ws-window-toolbar:first-child button:first-child",
			);
			await click(".ws-heading-actions .primary");
			await type('[role="dialog"] input', name);
			await click('[role="dialog"] button[type="submit"]');
			await until(() => evaluate("!document.querySelector('[role=dialog]')"));
			await until(
				() =>
					evaluate(
						"document.querySelector('.ws-workspace-tabs [data-tab-id][data-active=true]')?.textContent",
					),
				(value) => value === name,
			);
			await click("text:New terminal");
			await until(
				terminals,
				(rs) => rs.length === 1 && rs[0].state === "attached",
			);
		}
		await restart("quit");
		await until(
			terminals,
			(rs) => rs.length === 1 && rs[0].state === "attached",
		);
		assert.equal(
			await evaluate(
				"document.querySelectorAll('.ws-workspace-tabs [data-tab-id]').length",
			),
			3,
		);
		await click("text:Restore lifecycle");
		await until(
			terminals,
			(rs) => rs.length === 2 && rs.every((r) => r.state === "attached"),
		);
		report.threeWorkspaceTabs = true;
		await screenshot("restore-three-workspace-tabs");
		await controls.killDaemon();
		await restart("quit");
		await until(
			() => evaluate("window.directWorkstation.getWorkspaceRestore()"),
			(j) =>
				j?.status === "paused" ||
				j?.resources.some((r) => r.state === "interrupted"),
		);
		assert.equal(
			await evaluate("document.querySelectorAll('.ws-workspace-pane').length"),
			3,
		);
		assert.equal(
			(await terminals()).some((t) => t.state === "attached"),
			false,
		);
		report.daemonLostWithoutRespawn = true;
		await screenshot("restore-daemon-lost");
	}
	writeFileSync(
		join(output, "workspace-restore-ui.json"),
		JSON.stringify(report, null, 2) + "\n",
	);
	return report;
}
