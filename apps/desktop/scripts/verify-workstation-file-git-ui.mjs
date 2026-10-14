import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationFileGitUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let attempt = 0; attempt < 150; attempt++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error(
			`File/Git UI acceptance did not complete: ${await evaluate("document.body.innerText.slice(-1800)")}`,
		);
	};
	const replace = async (selector, text) => {
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
	const scope = await evaluate(
		`(async () => { const job=await window.directWorkstation.getWorkspaceRestore(); const view=(await window.directWorkstation.getWorkspaceView()).snapshot; const target=view.targets.find(t=>t.connectionId===view.activeConnectionId); const workspace=target.workspaces.find(w=>w.tabId===target.activeTabId); return {descriptor:job.descriptor,workspaceId:workspace.workspaceId}; })()`,
	);
	assert.equal(scope.descriptor.capabilities.workstationFilesV1, true);
	assert.equal(scope.descriptor.capabilities.workstationGitV1, true);
	const query = (path, input = {}) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path, type: "query", input: { workspaceId: scope.workspaceId, ...input } })})`,
		);
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const root = workspace.worktreePath;
	const path = (name) => `${root}/${name}`;
	const readText = async (name) => {
		const result = await query("filesystem.readFile", {
			absolutePath: path(name),
			maxBytes: 1024,
		});
		return result.kind === "text"
			? result.content
			: Buffer.from(result.content, "base64").toString("utf8");
	};
	const list = () => query("filesystem.listDirectory", { absolutePath: root });
	const exists = async (name) =>
		(await list()).entries.some((entry) => entry.name === name);
	const menu = async (name, action) => {
		const point = await evaluate(
			`(()=>{const row=document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path='+${JSON.stringify(JSON.stringify(name))}+']');if(!row)throw new Error('Missing file tree row');const r=row.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: "right",
				clickCount: 1,
				...point,
			});
		const selector = `[role=menuitem][data-file-action=${JSON.stringify(action)}]`;
		await until(() =>
			evaluate(
				`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return false; const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.width>0 && r.height>0 && hit?.closest('[role=menuitem]')===e; })()`,
			),
		);
		await screenshot(`feature-menu-${action}`);
		await click(selector);
		await until(() =>
			evaluate("Boolean(document.querySelector('[role=dialog]'))"),
		);
	};
	await click("text:Close file and discard draft");
	await click('button[aria-label="New File..."]');
	await replace("[role=dialog] input[aria-label=Name]", "feature-native.txt");
	await screenshot("feature-create-file");
	await click("[role=dialog] button[type=submit]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	assert.equal(await exists("feature-native.txt"), true);
	await click("tree:feature-native.txt");
	await until(() => evaluate("Boolean(document.querySelector('.cm-content'))"));
	await replace(".cm-content", "first\nfeature search candidate\nlast");
	await click("text:Save file");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save file')?.disabled",
		),
	);
	assert.equal(
		await readText("feature-native.txt"),
		"first\nfeature search candidate\nlast",
	);
	await click("text:Close file and discard draft");
	await click("text:Search files");
	await click("text:Content");
	await replace('input[aria-label="Search files"]', "feature search candidate");
	await until(() =>
		evaluate(
			"document.querySelector('[data-workspace-files] form button[type=submit]')?.disabled===false",
		),
	);
	await click("text:Search");
	await until(() =>
		evaluate("Boolean(document.querySelector('[data-search-line=\"2\"]'))"),
	);
	await click('[data-search-line="2"]');
	await until(() =>
		evaluate(
			"document.querySelector('.cm-activeLine')?.textContent==='feature search candidate'",
		),
	);
	const selection = await evaluate(
		"({activeLine:document.querySelector('.cm-activeLine').textContent,contents:document.querySelector('.cm-content').textContent})",
	);
	await screenshot("feature-content-search-line");
	await click("text:Close file and discard draft");
	await menu("feature-native.txt", "copy");
	await replace("[role=dialog] input[aria-label=Path]", "feature-copy.txt");
	await click("[role=dialog] button[type=submit]");
	await until(() => exists("feature-copy.txt"));
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	assert.equal(
		await readText("feature-copy.txt"),
		await readText("feature-native.txt"),
	);
	await menu("feature-copy.txt", "rename");
	await replace("[role=dialog] input[aria-label=Name]", "feature-renamed.txt");
	await click("[role=dialog] button[type=submit]");
	await until(() => exists("feature-renamed.txt"));
	assert.equal(await exists("feature-copy.txt"), false);
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await menu("feature-renamed.txt", "move");
	await replace("[role=dialog] input[aria-label=Path]", "feature-moved.txt");
	await click("[role=dialog] button[type=submit]");
	await until(() => exists("feature-moved.txt"));
	assert.equal(await exists("feature-renamed.txt"), false);
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await menu("feature-moved.txt", "delete");
	await screenshot("feature-permanent-delete-confirmation");
	assert.equal(await exists("feature-moved.txt"), true);
	await click("[role=dialog] button[type=submit]");
	await until(async () => !(await exists("feature-moved.txt")));
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await click("text:Changes");
	await until(() =>
		evaluate(
			"Boolean(document.querySelector('[data-workspace-files] input[type=email]'))",
		),
	);
	await replace(
		"[data-workspace-files] form input:not([type=email])",
		"Workspace UI Tester",
	);
	await replace(
		"[data-workspace-files] form input[type=email]",
		"ui-fixture@example.invalid",
	);
	await click("[data-workspace-files] form button[type=submit]");
	await until(
		async () => (await query("git.getUserIdentityV1")).configured === true,
	);
	await screenshot("feature-git-repository-identity");
	await until(() =>
		evaluate(
			'Boolean(document.querySelector(\'[data-git-path="feature-native.txt"] button[aria-label="Stage file"]\'))',
		),
	);
	await click(
		'[data-git-path="feature-native.txt"] button[aria-label="Stage file"]',
	);
	await until(async () =>
		(await query("git.getStatus")).staged.some(
			(file) => file.path === "feature-native.txt",
		),
	);
	await replace(
		'textarea[placeholder="Commit message"]',
		"Feature parity commit",
	);
	await screenshot("feature-git-staged-commit");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Commit')?.disabled===false",
		),
	);
	await click("text:Commit");
	await until(() =>
		evaluate(
			"document.querySelector('textarea[placeholder=\"Commit message\"]')?.value===''",
		),
	);
	const status = await query("git.getStatus");
	const committed = await query("git.getCommitFiles", { commitHash: "HEAD" });
	assert.deepEqual(
		committed.files.map((file) => file.path),
		["feature-native.txt"],
	);
	assert.ok(status.unstaged.some((file) => file.path === "restore-ui.txt"));
	assert.ok(!status.staged.some((file) => file.path === "feature-native.txt"));
	await screenshot("feature-git-committed");
	await click("text:Files");
	await click("tree:restore-ui.txt");
	await until(() =>
		evaluate(
			"document.querySelector('.cm-content')?.textContent==='after upstream editor'",
		),
	);
	writeFileSync(
		join(output, "workstation-file-git-ui.json"),
		`${JSON.stringify({ source: process.env.GITHUB_SHA, platform: process.platform, arch: process.arch, realInput: true, sourceTest: process.platform !== "darwin", selectedBackend: scope.descriptor.backendId, selectedNamespace: scope.descriptor.namespaceId, workspaceId: scope.workspaceId, create: true, edit: true, contentSearchLine: selection, copy: true, rename: true, move: true, confirmedPermanentDelete: true, stagedOnlyCommit: true, unstagedPreserved: true, committedFiles: committed.files.map((file) => file.path) }, null, 2)}\n`,
	);
}
