import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

export async function verifyWorkstationSetupUi({
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
		throw new Error(
			`Setup acceptance did not complete: ${await evaluate("document.body.innerText.slice(-1800)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=v.targets.find(t=>t.connectionId===d.connectionId),workspace=target.workspaces.find(w=>w.tabId===target.activeTabId);const row=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:workspace.workspaceId}});return {connectionId:d.connectionId,projectId:row.projectId,workspaceId:row.id,worktreePath:row.worktreePath,tabId:workspace.tabId};})()`,
	);
	const query = (path, input) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const text = async (selector, value) => {
		await click(selector);
		await getPage().call("Input.insertText", { text: value });
	};
	const physical = async (point) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: type === "mouseMoved" ? 0 : 1,
				...point,
			});
	};
	const pointFor = async (selector) =>
		until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			),
		);
	const visible = async (selector) => {
		for (let i = 0; i < 8; i++) {
			const r = await evaluate(
				`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,height:innerHeight}:null;})()`,
			);
			if (r && r.top > 80 && r.bottom < r.height - 10) return;
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 850,
				y: 600,
				deltaX: 0,
				deltaY: r?.top < 80 ? -350 : 350,
			});
			await delay(50);
		}
		throw new Error("Setup field is outside viewport");
	};
	const before = await query("config.getProjectScriptsV1", {
		projectId: scope.projectId,
	});
	const commands = [
		"mkdir -p .superset/attachments",
		"printf '*\\n' > .superset/attachments/.gitignore",
		"printf 'once\\n' >> .superset/attachments/setup-marker.txt",
		"printf 'SETUP_ACTUAL_OUTPUT\\n'",
	];
	async function configure(setup) {
		await click(
			'[data-slot=sidebar-content] button[aria-label="Project Settings"]',
		);
		await until(() =>
			evaluate(
				"Boolean(document.querySelector('[data-remote-project-scripts] [role=tab]'))",
			),
		);
		await visible("[data-remote-project-scripts] [role=tab]");
		const tab = await until(() =>
			evaluate(
				`(()=>{const e=[...document.querySelectorAll('[data-remote-project-scripts] [role=tab]')].find(e=>e.textContent.trim()==='Setup');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			),
		);
		await physical(tab);
		const selector = "[data-remote-project-scripts] textarea[aria-label=Setup]";
		await visible(selector);
		await click(selector);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		await getPage().call("Input.insertText", { text: setup.join("\n") });
		await until(
			async () =>
				JSON.stringify(
					(
						await query("config.getProjectScriptsV1", {
							projectId: scope.projectId,
						})
					).scripts.setup,
				) === JSON.stringify(setup),
		);
		await until(() =>
			evaluate(
				"document.querySelector('[data-project-scripts] [role=status]')?.textContent.trim()==='Saved'",
			),
		);
		await screenshot("setup-original-editor-saved");
		await click("[role=dialog] button[aria-label=Close]");
		await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	}
	const active = () =>
		evaluate(
			`(async()=>{const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const t=v.targets.find(t=>t.connectionId===${JSON.stringify(scope.connectionId)});return t.workspaces.find(w=>w.tabId===t.activeTabId);})()`,
		);
	async function create(name, runSetup) {
		await click(
			".ws-workspace-window .ws-window-toolbar:first-child button:first-child",
		);
		await click(".ws-heading-actions .primary");
		await text("[role=dialog] input", name);
		await click("[role=dialog] label:nth-of-type(3) select");
		for (const [key, code] of [
			["ArrowDown", 40],
			["Enter", 13],
		]) {
			await getPage().call("Input.dispatchKeyEvent", {
				type: "keyDown",
				key,
				windowsVirtualKeyCode: code,
			});
			await getPage().call("Input.dispatchKeyEvent", {
				type: "keyUp",
				key,
				windowsVirtualKeyCode: code,
			});
		}
		await until(() =>
			evaluate(
				"!!document.querySelector('[role=dialog] button[aria-label=\"Checkout: Worktree\"]')",
			),
		);
		const toggle = "[role=dialog] button[role=switch]";
		await until(() =>
			evaluate(
				`document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-checked')==='true'`,
			),
		);
		if (!runSetup) await physical(await pointFor(toggle));
		assert.equal(
			await evaluate(
				`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')`,
			),
			String(runSetup),
		);
		await screenshot(
			runSetup ? "setup-create-enabled" : "setup-create-skipped",
		);
		await physical(await pointFor("[role=dialog] button[type=submit]"));
		await until(() => evaluate("!document.querySelector('[role=dialog]')"));
		return until(async () => {
			const w = await active();
			return w?.label === name ? w : null;
		});
	}
	await configure(commands);
	const enabled = await create("Setup enabled", true);
	const setup = await until(() =>
		evaluate(
			"(()=>{const e=document.querySelector('[data-terminal-id]');return e?.dataset.restoreState==='attached'?{terminalId:e.dataset.terminalId,executionId:e.dataset.executionId}:null;})()",
		),
	);
	assert.equal(enabled.panes.length, 1);
	assert.equal(enabled.panes[0].label, "Setup");
	const row = await query("workspace.get", { id: enabled.workspaceId });
	const rootMarker = "/Superset Remix/worktrees/";
	const rootIndex = scope.worktreePath.lastIndexOf(rootMarker);
	assert.ok(rootIndex >= 0);
	const managedRoot = scope.worktreePath.slice(
		0,
		rootIndex + rootMarker.length,
	);
	assert.ok(row.worktreePath.startsWith(managedRoot));
	const projectFolder = row.worktreePath
		.slice(managedRoot.length)
		.split("/")[0];
	assert.ok(projectFolder.endsWith(`-${scope.projectId}`));
	writeFileSync(
		join(output, "setup-created-workspace.json"),
		JSON.stringify(
			{ workspace: row, managedRoot, projectFolder, terminal: setup },
			null,
			2,
		) + "\n",
	);
	const marker = async () => {
		const result = await query("filesystem.readFile", {
			workspaceId: enabled.workspaceId,
			absolutePath: `${row.worktreePath}/.superset/attachments/setup-marker.txt`,
			maxBytes: 128,
		});
		return result.kind === "text"
			? result.content
			: Buffer.from(result.content, "base64").toString("utf8");
	};
	await until(async () => {
		try {
			return (await marker()) === "once\n";
		} catch {
			return false;
		}
	});
	const initial = await until(async () => {
		const value = await controls.inspectRunExecution(setup);
		return stripVTControlCharacters(value.output)
			.replace(/\r/g, "")
			.split("\n")
			.includes("SETUP_ACTUAL_OUTPUT")
			? value
			: null;
	});
	if (process.platform === "linux") assert.equal(initial.cwd, row.worktreePath);
	await screenshot("setup-original-terminal-output");
	await closeReopen();
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${setup.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	const restored = await controls.inspectRunExecution(setup);
	assert.equal(restored.pid, initial.pid);
	assert.equal(restored.executionId, initial.executionId);
	assert.equal(await marker(), "once\n");
	assert.equal(
		(await query("terminal.list", { workspaceId: enabled.workspaceId }))
			.sessions.length,
		1,
	);
	await screenshot("setup-same-terminal-after-reopen");
	const skipped = await create("Setup skipped", false);
	const skippedRow = await query("workspace.get", { id: skipped.workspaceId });
	assert.equal(
		(await query("terminal.list", { workspaceId: skipped.workspaceId }))
			.sessions.length,
		0,
	);
	assert.equal(
		await query("filesystem.getMetadata", {
			workspaceId: skipped.workspaceId,
			absolutePath: `${skippedRow.worktreePath}/.superset/attachments/setup-marker.txt`,
		}),
		null,
	);
	await screenshot("setup-skipped-without-terminal");
	await click("text:Restore lifecycle");
	await configure(before.scripts.setup);
	for (const w of [enabled, skipped]) {
		const selector = `.ws-workspace-tabs [data-tab-id="${w.tabId}"] button[aria-label="Close tab"]`;
		const rect = await evaluate(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		await getPage().call("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "none",
			...rect,
		});
		await physical(await pointFor(selector));
	}
	await until(async () => (await active())?.tabId === scope.tabId);
	writeFileSync(
		join(output, "workstation-setup-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalSetupOption: true,
				originalSetupEditor: true,
				enabledWorkspace: enabled.workspaceId,
				terminalId: setup.terminalId,
				executionId: setup.executionId,
				pid: initial.pid,
				cwd: initial.cwd,
				outputObserved: true,
				marker: "once\n",
				windowReopenSamePid: true,
				windowReopenDidNotRunAgain: true,
				skippedWorkspace: skipped.workspaceId,
				skippedNoTerminal: true,
				skippedNoMarker: true,
				configRestored: true,
				originalViewRestored: true,
				vendorAgentVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
