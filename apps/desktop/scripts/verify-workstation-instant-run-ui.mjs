import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

export async function verifyWorkstationInstantRunUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	controls,
	output,
}) {
	const evaluate = (e) => getPage().evaluate(e);
	const until = async (read) => {
		for (let i = 0; i < 200; i++) {
			const v = await read();
			if (v) return v;
			await delay(50);
		}
		throw new Error(
			`Instant Run UI not ready: ${await evaluate("document.body.innerText.slice(-2000)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const t=v.targets.find(t=>t.connectionId===d.connectionId);const w=t.workspaces.find(w=>w.tabId===t.activeTabId);const row=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {...w,connectionId:d.connectionId,projectId:row.projectId,worktreePath:row.worktreePath};})()`,
	);
	const query = (path, input) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const state = () =>
		query("workspaceRun.getStateV1", { workspaceId: scope.workspaceId });
	const before = await query("config.getProjectScriptsV1", {
		projectId: scope.projectId,
	});
	const physical = async (point) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: type === "mouseMoved" ? 0 : 1,
				...point,
			});
	};
	async function visible(selector) {
		for (let i = 0; i < 10; i++) {
			const p = await evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:{scroll:r.top<80?-350:350};})()`,
			);
			if (p?.x !== undefined) return p;
			if (p?.scroll)
				await getPage().call("Input.dispatchMouseEvent", {
					type: "mouseWheel",
					x: 850,
					y: 600,
					deltaX: 0,
					deltaY: p.scroll,
				});
			await delay(50);
		}
		throw new Error(`Instant Run control not visible: ${selector}`);
	}
	async function configure(commands) {
		await click(
			'[data-slot=sidebar-content] button[aria-label="Project Settings"]',
		);
		await until(() =>
			evaluate("!!document.querySelector('[data-remote-project-scripts]')"),
		);
		await visible("[data-remote-project-scripts] [role=tab]");
		const tab = await until(() =>
			evaluate(
				`(()=>{const e=[...document.querySelectorAll('[data-remote-project-scripts] [role=tab]')].find(e=>e.textContent.trim()==='Run');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			),
		);
		await physical(tab);
		const field = "[data-remote-project-scripts] textarea[aria-label=Run]";
		await physical(await visible(field));
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		await getPage().call("Input.insertText", { text: commands.join("\n") });
		await until(
			async () =>
				JSON.stringify(
					(
						await query("config.getProjectScriptsV1", {
							projectId: scope.projectId,
						})
					).scripts.run,
				) === JSON.stringify(commands),
		);
		await until(() =>
			evaluate(
				"document.querySelector('[data-project-scripts] [role=status]')?.textContent.trim()==='Saved'",
			),
		);
		await click("[role=dialog] button[aria-label=Close]");
		await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	}
	const marker = async () => {
		const r = await query("filesystem.readFile", {
			workspaceId: scope.workspaceId,
			absolutePath:
				scope.worktreePath + "/.superset/attachments/instant-run-marker.txt",
			maxBytes: 256,
		});
		return r.kind === "text"
			? r.content
			: Buffer.from(r.content, "base64").toString("utf8");
	};
	const start =
		'[data-workspace-run] button[aria-label="Run workspace command"]';
	async function launch(code, previous) {
		await until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(start)});return e&&!e.disabled;})()`,
			),
		);
		await click(start);
		const run = await until(async () => {
			const s = (await state()).run;
			return s?.operationId !== previous &&
				s?.state === "ended" &&
				s?.exitCode === code
				? s
				: null;
		});
		assert.equal(run.completionTracked, true);
		await until(() =>
			evaluate(
				`document.querySelector('[data-run-exit-code="${code}"]')!==null`,
			),
		);
		await until(() =>
			evaluate(
				`document.querySelector('[data-terminal-id="${run.terminalId}"]')?.dataset.restoreState==='attached'`,
			),
		);
		return run;
	}
	await configure([
		"mkdir -p .superset/attachments",
		"printf '*\\n' > .superset/attachments/.gitignore",
		"printf 'once\\n' >> .superset/attachments/instant-run-marker.txt",
		"printf 'INSTANT_RUN_ACTUAL_SUCCESS\\n'",
	]);
	const success = await launch(0, (await state()).run?.operationId);
	assert.equal(await marker(), "once\n");
	const successProcess = await until(async () => {
		const value = await controls.inspectRunExecution(success);
		return stripVTControlCharacters(value.output)
			.replace(/\r/g, "")
			.split("\n")
			.includes("INSTANT_RUN_ACTUAL_SUCCESS")
			? value
			: null;
	});
	assert.ok(
		stripVTControlCharacters(successProcess.output)
			.replace(/\r/g, "")
			.split("\n")
			.includes("INSTANT_RUN_ACTUAL_SUCCESS"),
	);
	assert.equal(successProcess.alive, true);
	const paneId = await evaluate(
		`document.querySelector('[data-terminal-id="${success.terminalId}"]').closest('[data-pane-id]').dataset.paneId`,
	);
	await screenshot("instant-run-success-and-output");
	await configure([
		"printf 'failed\\n' >> .superset/attachments/instant-run-marker.txt",
		"printf 'INSTANT_RUN_ACTUAL_FAILURE\\n'",
		"sh -c 'exit 17'",
	]);
	const failed = await launch(17, success.operationId);
	assert.equal(await marker(), "once\nfailed\n");
	assert.equal(
		await evaluate(
			`document.querySelector('[data-terminal-id="${failed.terminalId}"]').closest('[data-pane-id]').dataset.paneId`,
		),
		paneId,
	);
	const failedProcess = await until(async () => {
		const value = await controls.inspectRunExecution(failed);
		return stripVTControlCharacters(value.output)
			.replace(/\r/g, "")
			.split("\n")
			.includes("INSTANT_RUN_ACTUAL_FAILURE")
			? value
			: null;
	});
	assert.equal(failedProcess.alive, true);
	assert.ok(
		stripVTControlCharacters(failedProcess.output)
			.replace(/\r/g, "")
			.split("\n")
			.includes("INSTANT_RUN_ACTUAL_FAILURE"),
	);
	await screenshot("instant-run-failure-code-and-output");
	await closeReopen();
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${failed.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	assert.equal((await state()).run.operationId, failed.operationId);
	assert.equal(
		(await controls.inspectRunExecution(failed)).pid,
		failedProcess.pid,
	);
	assert.equal(await marker(), "once\nfailed\n");
	await screenshot("instant-run-reopened-without-replay");
	await configure(before.scripts.run);
	const closePoint = await until(() =>
		evaluate(
			`(()=>{let e=document.querySelector('[data-pane-title-id="${paneId}"]');while(e&&!e.querySelector('button[aria-label="Close pane"]'))e=e.parentElement;const b=e?.querySelector('button[aria-label="Close pane"]');if(!b)return null;const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return b.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	await physical(closePoint);
	await until(() =>
		evaluate("document.querySelectorAll('[data-terminal-id]').length===3"),
	);
	const restored = await evaluate(
		`(async()=>{const v=(await window.directWorkstation.getWorkspaceView()).snapshot;return v.targets.flatMap(t=>t.workspaces).find(w=>w.workspaceId===${JSON.stringify(scope.workspaceId)});})()`,
	);
	assert.deepEqual(restored.layout, scope.layout);
	if (scope.activePaneId) {
		await click(`[data-pane-id="${scope.activePaneId}"] .xterm-screen`);
		await until(() =>
			evaluate(
				`(async()=>{const v=(await window.directWorkstation.getWorkspaceView()).snapshot;return v.targets.flatMap(t=>t.workspaces).find(w=>w.workspaceId===${JSON.stringify(scope.workspaceId)}).activePaneId===${JSON.stringify(scope.activePaneId)};})()`,
			),
		);
	}
	writeFileSync(
		join(output, "workstation-instant-run-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				configuredThroughOriginalEditor: true,
				success: {
					operationId: success.operationId,
					exitCode: success.exitCode,
					foregroundSeen: success.foregroundSeen,
					pid: successProcess.pid,
				},
				failure: {
					operationId: failed.operationId,
					exitCode: failed.exitCode,
					foregroundSeen: failed.foregroundSeen,
					pid: failedProcess.pid,
				},
				outputAttachedAfterCompletion: true,
				originalPaneReused: true,
				windowReopenSamePid: true,
				marker: "once\nfailed\n",
				noReplay: true,
				originalConfigRestored: true,
				originalLayoutRestored: true,
				vendorAgentVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
