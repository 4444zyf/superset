import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationRunUi({
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
		await screenshot("workspace-run-failure");
		throw new Error(
			`Workspace run UI did not complete: ${await evaluate("document.body.innerText.slice(-2000)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=v.targets.find(t=>t.connectionId===d.connectionId);const workspace=target.workspaces.find(w=>w.tabId===target.activeTabId);return {workspaceId:workspace.workspaceId,connectionId:d.connectionId};})()`,
	);
	const query = () =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspaceRun.getStateV1',type:'query',input:${JSON.stringify({ workspaceId: scope.workspaceId })}});})()`,
		);
	const physical = async (point) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: type === "mouseMoved" ? 0 : 1,
				...point,
			});
	};
	const visible = async (selector) => {
		for (let i = 0; i < 8; i++) {
			const rect = await evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()`,
			);
			assert.ok(rect);
			if (rect.top >= 80 && rect.bottom < rect.height - 10) return;
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 850,
				y: 600,
				deltaX: 0,
				deltaY: rect.top < 80 ? -350 : 350,
			});
			await delay(50);
		}
		throw new Error("Run field is outside viewport");
	};
	const closePane = async (run) => {
		const paneId = await evaluate(
			`(async()=>{const v=(await window.directWorkstation.getWorkspaceView()).snapshot;return v.targets.flatMap(t=>t.workspaces).find(w=>w.workspaceId===${JSON.stringify(scope.workspaceId)}).panes.find(p=>p.resourceId===${JSON.stringify(run.terminalId)}).paneId;})()`,
		);
		const point = await until(() =>
			evaluate(
				`(()=>{let e=document.querySelector('[data-pane-title-id="${paneId}"]');while(e&&!e.querySelector('button[aria-label="Close pane"]'))e=e.parentElement;const button=e?.querySelector('button[aria-label="Close pane"]');if(!button)return null;const r=button.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return button.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			),
		);
		await physical(point);
		await until(() =>
			evaluate(`!document.querySelector('[data-pane-id="${paneId}"]')`),
		);
	};
	const configure =
		'[data-workspace-run] button[aria-label="Workspace run options"]';
	await until(() =>
		evaluate(`!!document.querySelector(${JSON.stringify(configure)})`),
	);
	await click(configure);
	const configurePoint = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='Configure');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	await physical(configurePoint);
	const runTab = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('[data-remote-project-scripts] [role=tab]')].find(e=>e.textContent.trim()==='Run');if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})()`,
		),
	);
	assert.ok(runTab);
	await visible("[data-remote-project-scripts] [role=tab]");
	const tabPoint = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('[data-remote-project-scripts] [role=tab]')].find(e=>e.textContent.trim()==='Run');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	await physical(tabPoint);
	const field = "[data-remote-project-scripts] textarea[aria-label=Run]";
	await visible(field);
	await click(field);
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "a",
		code: "KeyA",
		windowsVirtualKeyCode: 65,
		modifiers: process.platform === "darwin" ? 4 : 2,
		commands: ["selectAll"],
	});
	await getPage().call("Input.insertText", {
		text: "echo REMIX_RUN_ACTUAL_OUTPUT\nsleep 120",
	});
	await until(() =>
		evaluate(
			"document.querySelector('[data-project-scripts] [role=status]')?.textContent.trim()==='Saved'",
		),
	);
	await click("[role=dialog] button[aria-label=Close]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await until(async () => {
		const current = await query();
		return current.definition?.commands.includes("sleep 120");
	});
	await click("text:Files");
	const start =
		'[data-workspace-run] button[aria-label="Run workspace command"]';
	const stop =
		'[data-workspace-run] button[aria-label="Stop workspace run command"]';
	await until(() =>
		evaluate(
			`(()=>{const b=document.querySelector(${JSON.stringify(start)});return b&&!b.disabled;})()`,
		),
	);
	await click(start);
	const first = await until(async () => {
		const current = await query();
		return current.run?.state === "active" && current.run.foregroundSeen
			? current.run
			: null;
	});
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${first.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	const firstProcess = await until(async () => {
		const value = await controls.inspectRunExecution(first);
		return /\r?\nREMIX_RUN_ACTUAL_OUTPUT\r?\n/.test(value.output)
			? value
			: null;
	});
	await screenshot("workspace-run-original-control-and-output");
	await until(() =>
		evaluate(`!document.querySelector(${JSON.stringify(stop)}).disabled`),
	);
	await click(stop);
	await until(async () => (await query()).run?.state === "ended");
	const stopped = await controls.inspectRunExecution(first);
	assert.equal(stopped.executionId, first.executionId);
	assert.equal(stopped.alive, true);
	await screenshot("workspace-run-normal-stop");
	await closePane(first);
	await until(() =>
		evaluate(
			`(()=>{const b=document.querySelector(${JSON.stringify(start)});return b&&!b.disabled;})()`,
		),
	);
	await click(start);
	const second = await until(async () => {
		const current = await query();
		return current.run?.operationId !== first.operationId &&
			current.run?.state === "active" &&
			current.run.foregroundSeen
			? current.run
			: null;
	});
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${second.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	const before = await controls.inspectRunExecution(second);
	await screenshot("workspace-run-before-window-close");
	await closeReopen();
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${second.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	const restored = (await query()).run;
	assert.equal(restored.operationId, second.operationId);
	assert.equal(restored.executionId, second.executionId);
	const after = await controls.inspectRunExecution(second);
	assert.equal(after.pid, before.pid);
	assert.equal(after.alive, true);
	await screenshot("workspace-run-same-execution-after-reopen");
	const hostRestart = await controls.restartHost();
	await closeReopen();
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${second.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	const afterRestart = await controls.inspectRunExecution(second);
	assert.equal(afterRestart.pid, before.pid);
	assert.equal(afterRestart.executionId, second.executionId);
	assert.equal((await query()).run.operationId, second.operationId);
	await screenshot("workspace-run-same-execution-after-host-restart");
	await click(configure);
	const forcePoint = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='Force Stop');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	await physical(forcePoint);
	await until(async () => (await query()).run?.state === "ended");
	const forced = await until(async () => {
		const value = await controls.inspectRunExecution(second);
		return !value.alive && !value.processExists ? value : null;
	});
	await screenshot("workspace-run-force-stopped");
	await closePane(second);
	await until(() =>
		evaluate("document.querySelectorAll('[data-terminal-id]').length===3"),
	);
	writeFileSync(
		join(output, "workstation-run-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalRunControl: true,
				configuredThroughOriginalEditor: true,
				startedFromFiles: true,
				foregroundObserved: true,
				outputObserved: true,
				first: {
					operationId: first.operationId,
					terminalId: first.terminalId,
					executionId: first.executionId,
					pid: firstProcess.pid,
				},
				normalStop: { ended: true, terminalRemainsAlive: stopped.alive },
				reopened: {
					operationId: second.operationId,
					terminalId: second.terminalId,
					executionId: second.executionId,
					pidBefore: before.pid,
					pidAfter: after.pid,
				},
				hostRestart: {
					...hostRestart,
					samePid: afterRestart.pid === before.pid,
					sameExecution: true,
				},
				forceStop: { alive: forced.alive, processExists: forced.processExists },
				remainingVisibleTerminals: 3,
				vendorAgent: false,
			},
			null,
			2,
		) + "\n",
	);
}
