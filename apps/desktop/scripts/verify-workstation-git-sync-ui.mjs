import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationGitSyncUi({
	getPage,
	click,
	screenshot,
	output,
	scope,
	remote,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	let step = "initial";
	const until = async (read) => {
		for (let i = 0; i < 150; i++) {
			const value = await read();
			if (value) return value;
			await delay(50);
		}
		throw new Error(`Git sync UI acceptance did not complete: ${step}`);
	};
	const query = (path, input = {}) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path, type: "query", input: { workspaceId: scope.workspaceId, ...input } })})`,
		);
	const enabled = (text) =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});return e?.disabled===false;})()`,
		);
	const replace = async (selector, text) => {
		await until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e && !e.disabled && e.getBoundingClientRect().height>0;})()`,
			),
		);
		await click(selector);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		await getPage().call("Input.insertText", { text });
	};
	const commit = async (message) => {
		await until(() => enabled("Stage all"));
		await click("text:Stage all");
		await replace('textarea[placeholder="Commit message"]', message);
		await until(() => enabled("Commit"));
		await click("text:Commit");
		await until(() =>
			evaluate(
				"document.querySelector('textarea[placeholder=\"Commit message\"]')?.value===''",
			),
		);
	};
	const head = async () =>
		(await query("git.listRepositoryCommitsV1", { limit: 1 })).head;
	const menu = async (action) => {
		await until(() => enabled("More actions"));
		await click("text:More actions");
		const selector = `[role=menuitem][data-git-sync-action=${JSON.stringify(action)}]`;
		await until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.hasAttribute('data-disabled');})()`,
			),
		);
		await screenshot(`git-original-sync-action-${action}`);
		await click(selector);
		await until(() => evaluate("!document.querySelector('[role=menu]')"));
	};
	step = "commit current fixture changes";
	await click("text:Files");
	await click("text:Changes");
	await commit("Prepare sync fixture");
	await until(() => enabled("Push"));
	await click("text:Push");
	const prepared = await head();
	await until(async () => remote.readHead("feature-renamed") === prepared);
	step = "fetch remote update";
	const first = remote.advanceRemote("feature-renamed", "remote one\n");
	await menu("fetch");
	await until(
		async () => (await query("git.getBranchSyncStatus")).pullCount === 1,
	);
	assert.equal(await head(), prepared);
	await screenshot("git-original-sync-menu-after-fetch");
	step = "pull remote update";
	await menu("pull");
	await until(async () => (await head()) === first);
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const readText = async () => {
		const result = await query("filesystem.readFile", {
			absolutePath: workspace.worktreePath + "/sync-ui.txt",
			maxBytes: 1024,
		});
		return result.kind === "text"
			? result.content
			: Buffer.from(result.content, "base64").toString("utf8");
	};
	assert.equal(await readText(), "remote one\n");
	await click("text:Files");
	const treeReady = (name) =>
		evaluate(
			`Boolean(document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path='+${JSON.stringify(JSON.stringify(name))}+']'))`,
		);
	await until(() => treeReady("sync-ui.txt"));
	await click("tree:sync-ui.txt");
	const contents = () =>
		evaluate(
			"[...document.querySelectorAll('.cm-content')].find(e=>e.getBoundingClientRect().height>0)?.textContent",
		);
	await until(async () => (await contents()) === "remote one");
	await screenshot("git-pulled-remote-original-editor");
	step = "local commit for divergent sync";
	await until(() =>
		evaluate(
			"document.querySelector('button[aria-label=\"New File...\"]')?.disabled===false",
		),
	);
	await click('button[aria-label="New File..."]');
	await replace("[role=dialog] input[aria-label=Name]", "sync-local-ui.txt");
	await click("[role=dialog] button[type=submit]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await click("text:Changes");
	await commit("Local sync fixture change");
	const localBefore = await head();
	const remoteBefore = remote.advanceRemote("feature-renamed", "remote two\n");
	await menu("fetch");
	await until(async () => {
		const s = await query("git.getBranchSyncStatus");
		return s.pullCount === 1 && s.pushCount === 1;
	});
	step = "sync divergent commits";
	await menu("sync");
	const synchronized = await until(async () => {
		const s = await query("git.getBranchSyncStatus");
		return s.pullCount === 0 && s.pushCount === 0 ? s : null;
	});
	const after = await head();
	assert.equal(remote.readHead("feature-renamed"), after);
	assert.notEqual(after, localBefore);
	assert.notEqual(after, remoteBefore);
	assert.equal(await readText(), "remote two\n");
	await click("text:Files");
	await until(() => treeReady("sync-ui.txt"));
	await click("tree:sync-ui.txt");
	await until(async () => (await contents()) === "remote two");
	await screenshot("git-synced-divergent-original-editor");
	step = "fetch and pull combined action";
	const combinedHead = remote.advanceRemote(
		"feature-renamed",
		"remote three\n",
	);
	await click("text:Changes");
	await menu("fetch-pull");
	await until(async () => (await head()) === combinedHead);
	assert.equal(await readText(), "remote three\n");
	await click("text:Files");
	await until(() => treeReady("sync-ui.txt"));
	await click("tree:sync-ui.txt");
	await until(async () => (await contents()) === "remote three");
	await screenshot("git-fetch-and-pull-original-editor");

	const pending = await evaluate(
		`window.directWorkstation.listPending(${JSON.stringify(scope.descriptor.connectionId)})`,
	);
	assert.equal(pending.length, 0);
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-git-sync-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalSyncMenu: true,
				fetchDidNotMoveHead: true,
				pullHead: first,
				originalEditorReloaded: true,
				localBeforeSync: localBefore,
				remoteBeforeSync: remoteBefore,
				synchronizedHead: after,
				fetchAndPullHead: combinedHead,
				synchronized,
				pendingOperations: pending.length,
				transport: "owned local bare repository on SSH backend",
				githubAuthenticationVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
