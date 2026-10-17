import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationCleanupUi({
	getPage,
	click,
	screenshot,
	closeReopen,
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
			`Cleanup UI not ready: ${await evaluate("document.body.innerText.slice(-2400)")}`,
		);
	};
	const setup = JSON.parse(
		readFileSync(join(output, "workstation-setup-ui.json"), "utf8"),
	);
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const t=v.targets.find(t=>t.connectionId===d.connectionId);return {connectionId:d.connectionId,tabId:t.activeTabId,workspaceId:t.workspaces.find(w=>w.tabId===t.activeTabId).workspaceId};})()`,
	);
	const query = (path, input) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const ready = () =>
		until(() =>
			evaluate(
				`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready' && r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
			),
		);
	const enabled = await query("workspace.get", { id: setup.enabledWorkspace });
	const skipped = await query("workspace.get", { id: setup.skippedWorkspace });
	const before = await query("config.getProjectScriptsV1", {
		projectId: enabled.projectId,
	});
	const project = await query("project.get", { projectId: enabled.projectId });
	const marker = join(
		project.repoPath,
		".superset/attachments/teardown-marker.txt",
	);
	assert.equal(existsSync(marker), false);
	const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
	const command = `mkdir -p ${shellQuote(join(project.repoPath, ".superset/attachments"))} && printf 'once\\n' >> ${shellQuote(marker)}`;
	const physical = async (point) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: type === "mouseMoved" ? 0 : 1,
				...point,
			});
	};
	async function press(selector) {
		for (let i = 0; i < 12; i++) {
			const position = await evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}: {scroll:r.top<80?-300:300};})()`,
			);
			if (position && position.x !== undefined) {
				await physical(position);
				return;
			}
			if (position?.scroll)
				await getPage().call("Input.dispatchMouseEvent", {
					type: "mouseWheel",
					x: 1100,
					y: 650,
					deltaX: 0,
					deltaY: position.scroll,
				});
			await delay(50);
		}
		throw new Error(`Cleanup input is not available: ${selector}`);
	}
	const byText = async (label, role = "button") => {
		const point = await until(() =>
			evaluate(
				`(()=>{const e=[...document.querySelectorAll('[role=alertdialog] ${role}')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			),
		);
		await physical(point);
	};
	let configSequence = 0;
	async function configure(commands) {
		await click(
			'[data-slot=sidebar-content] button[aria-label="Project Settings"]',
		);
		await until(() =>
			evaluate("!!document.querySelector('[data-remote-project-scripts]')"),
		);
		for (let i = 0; i < 10; i++) {
			const point = await evaluate(
				`(()=>{const e=[...document.querySelectorAll('[data-remote-project-scripts] [role=tab]')].find(e=>e.textContent.trim()==='Teardown');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			);
			if (point) {
				await physical(point);
				break;
			}
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 850,
				y: 600,
				deltaX: 0,
				deltaY: 350,
			});
			await delay(50);
		}
		const field = "[data-remote-project-scripts] textarea[aria-label=Teardown]";
		await press(field);
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
							projectId: enabled.projectId,
						})
					).scripts.teardown,
				) === JSON.stringify(commands),
		);
		await until(() =>
			evaluate(
				"document.querySelector('[data-project-scripts] [role=status]')?.textContent.trim()==='Saved'",
			),
		);
		await screenshot(`cleanup-original-teardown-editor-${++configSequence}`);
		await click("[role=dialog] button[aria-label=Close]");
		await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	}
	const browse = async () => {
		if (await evaluate("!!document.querySelector('.ws-workspace-window')"))
			await click(
				".ws-workspace-window .ws-window-toolbar:first-child button:first-child",
			);
		await until(() =>
			evaluate("!!document.querySelector('.ws-workspace-grid')"),
		);
	};
	const openDelete = async (id) => {
		await browse();
		await press(`[data-workspace-delete="${id}"]`);
		await until(() =>
			evaluate("!!document.querySelector('[role=alertdialog]')"),
		);
	};
	await configure([command, "printf 'TEARDOWN_ACTUAL_FAILURE\\n'", "exit 17"]);
	await browse();
	await press('button.ws-workspace-card[aria-label="Setup enabled"]');
	await until(() =>
		evaluate(
			`document.querySelector('[data-terminal-id="${setup.terminalId}"]')?.dataset.restoreState==='attached'`,
		),
	);
	await press(`[data-terminal-id="${setup.terminalId}"] .xterm-screen`);
	await getPage().call("Input.insertText", {
		text: "printf dirty > delete-warning.txt",
	});
	for (const type of ["keyDown", "keyUp"])
		await getPage().call("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
	await until(() =>
		existsSync(join(enabled.worktreePath, "delete-warning.txt")),
	);
	await openDelete(enabled.id);
	await until(() =>
		evaluate(
			"document.querySelector('[role=alertdialog]').textContent.includes('Has uncommitted changes')",
		),
	);
	await screenshot("cleanup-original-warning-cancel");
	await byText("Cancel");
	assert.ok(existsSync(enabled.worktreePath));
	assert.equal(existsSync(marker), false);
	await openDelete(enabled.id);
	await byText("Delete anyway");
	await until(() =>
		evaluate(
			"document.querySelector('[role=alertdialog]')?.textContent.includes('TEARDOWN_ACTUAL_FAILURE')",
		),
	);
	assert.equal(readFileSync(marker, "utf8"), "once\n");
	assert.ok(existsSync(enabled.worktreePath));
	assert.ok(
		(await query("workspace.list", undefined)).some((w) => w.id === enabled.id),
	);
	await screenshot("cleanup-original-teardown-failed");
	await closeReopen();
	await ready();
	assert.equal(readFileSync(marker, "utf8"), "once\n");
	await openDelete(enabled.id);
	await press("[role=alertdialog] button[role=checkbox]");
	await byText("Delete anyway");
	await until(() =>
		evaluate(
			"document.querySelector('[role=alertdialog]')?.textContent.includes('TEARDOWN_ACTUAL_FAILURE')",
		),
	);
	assert.equal(readFileSync(marker, "utf8"), "once\nonce\n");
	await byText("Delete anyway");
	await until(() => !existsSync(enabled.worktreePath));
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	assert.equal(readFileSync(marker, "utf8"), "once\nonce\n");
	assert.equal(
		(await query("workspace.list", undefined)).some((w) => w.id === enabled.id),
		false,
	);
	const views = await evaluate("window.directWorkstation.getWorkspaceView()");
	assert.equal(
		views.snapshot.targets
			.find((t) => t.connectionId === scope.connectionId)
			.workspaces.some((w) => w.workspaceId === enabled.id),
		false,
	);
	assert.equal(
		execFileSync(
			"git",
			["-C", project.repoPath, "branch", "--list", enabled.branch],
			{ encoding: "utf8" },
		).trim(),
		"",
	);
	await screenshot("cleanup-worktree-removed");
	await press('[data-tab-id="' + scope.tabId + '"]');
	await configure([command]);
	await openDelete(skipped.id);
	const inspection = await query("workspaceCleanup.inspect", {
		workspaceId: skipped.id,
	});
	assert.equal(inspection.canDelete, true);
	await byText(
		inspection.hasChanges || inspection.hasUnpushedCommits
			? "Delete anyway"
			: "Delete",
	);
	await until(() => !existsSync(skipped.worktreePath));
	assert.equal(readFileSync(marker, "utf8"), "once\nonce\nonce\n");
	assert.ok(
		execFileSync(
			"git",
			["-C", project.repoPath, "branch", "--list", skipped.branch],
			{ encoding: "utf8" },
		).trim(),
	);
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	await press('[data-tab-id="' + scope.tabId + '"]');
	await configure(before.scripts.teardown);
	await closeReopen();
	await ready();
	await until(() =>
		evaluate(
			"document.querySelectorAll('[data-terminal-id][data-restore-state=attached]').length===3",
		),
	);
	assert.equal(readFileSync(marker, "utf8"), "once\nonce\nonce\n");
	const list = await query("workspace.list", undefined);
	assert.equal(
		list.some((w) => w.id === enabled.id || w.id === skipped.id),
		false,
	);
	await until(() =>
		evaluate(
			`document.querySelector('[data-tab-id="${scope.tabId}"]')?.getAttribute('data-active')==='true' || !!document.querySelector('[data-terminal-id]')`,
		),
	);
	await screenshot("cleanup-reopened-without-replay");
	writeFileSync(
		join(output, "workstation-cleanup-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalConfirmAndWarnings: true,
				cancelDidNotDelete: true,
				teardownFailureExitCode: 17,
				failedWorkspaceRestored: true,
				reopenDidNotReplay: true,
				explicitSkipDidNotRunTeardown: true,
				successfulTeardownRanOnce: true,
				deletedWorkspaces: [enabled.id, skipped.id],
				worktreesRemoved: true,
				savedDeletedTabsRemoved: true,
				explicitBranchDeleted: true,
				defaultBranchKept: true,
				configRestored: true,
			},
			null,
			2,
		) + "\n",
	);
}
