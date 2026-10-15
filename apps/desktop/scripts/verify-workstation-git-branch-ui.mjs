import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationGitBranchUi({
	getPage,
	click,
	screenshot,
	output,
	controls,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		for (let i = 0; i < 150; i++) {
			const result = await read();
			if (result) return result;
			await delay(50);
		}
		throw new Error("Branch UI acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const view=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=view.targets.find(t=>t.connectionId===view.activeConnectionId);return {descriptor:d,workspaceId:target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId};})()`,
	);
	const query = (path, input = {}) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path, type: "query", input: { workspaceId: scope.workspaceId, ...input } })})`,
		);
	const enabled = (text) =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('[data-branch-actions] button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});return e?.disabled===false;})()`,
		);
	await click("text:Files");
	await click("text:Changes");
	await until(() => enabled("Rename branch"));
	const before = await query("git.getBranchSyncStatus");
	assert.equal(before.hasUpstream, false);
	await click("text:Rename branch");
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=dialog] input'))"),
	);
	await click("[role=dialog] input");
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "a",
		code: "KeyA",
		windowsVirtualKeyCode: 65,
		modifiers: process.platform === "darwin" ? 4 : 2,
		commands: ["selectAll"],
	});
	const branch = "feature-renamed";
	await getPage().call("Input.insertText", { text: branch });
	await screenshot("git-original-rename-dialog");
	await click("[role=dialog] button[type=submit]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	const renamed = await until(async () => {
		const s = await query("git.getBranchSyncStatus");
		return s.currentBranch === branch ? s : null;
	});
	await until(() =>
		evaluate(
			`document.querySelector('[data-branch-actions] code')?.textContent===${JSON.stringify(branch)}`,
		),
	);
	await screenshot("git-renamed-branch-confirmed");
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const remote = controls.prepareGitRemote(workspace.worktreePath);
	await click("text:Terminal");
	await click("text:Files");
	await click("text:Changes");
	await until(() => enabled("Push"));
	await click("text:Push");
	const pushed = await until(async () => {
		const s = await query("git.getBranchSyncStatus");
		return s.currentBranch === branch && s.hasUpstream && s.pushCount === 0
			? s
			: null;
	});
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('[data-branch-actions] button')].filter(e=>['Push','Rename branch'].includes(e.textContent.trim())).every(e=>e.disabled)",
		),
	);
	const history = await query("git.listRepositoryCommitsV1", { limit: 1 });
	assert.equal(remote.readHead(branch), history.head);
	const pending = await evaluate(
		`window.directWorkstation.listPending(${JSON.stringify(scope.descriptor.connectionId)})`,
	);
	assert.equal(pending.length, 0);
	await screenshot("git-pushed-owned-remote-confirmed");
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-git-branch-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalRenameDialog: true,
				originalPushButton: true,
				before,
				renamed,
				pushed,
				remoteHead: history.head,
				remoteTransport: "owned local bare repository on SSH backend",
				supersetAccount: false,
				githubAuthenticationVerified: false,
				pendingOperations: pending.length,
			},
			null,
			2,
		) + "\n",
	);
}
