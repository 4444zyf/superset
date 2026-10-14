import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationFileTreeUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		for (let i = 0; i < 150; i++) {
			if (await read()) return;
			await delay(50);
		}
		throw new Error("File tree UI acceptance did not complete");
	};
	const row = (path) =>
		`document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path='+${JSON.stringify(JSON.stringify(path))}+']:not([data-file-tree-sticky-row])')`;
	const input = async (value) => {
 await until(()=>evaluate("Boolean(document.querySelector('[role=dialog] input[aria-label=Name]'))"));
		await click("[role=dialog] input[aria-label=Name]");
		await getPage().call("Input.insertText", { text: value });
	};
	await click("text:Files");
	await until(()=>evaluate("document.querySelector('button[aria-label=\"New Folder...\"]')?.disabled===false"));
 await click('button[aria-label="New Folder..."]');
	await input("feature-tree-folder");
	await click("[role=dialog] button[type=submit]");
	await until(() =>
		evaluate(
			`!document.querySelector('[role=dialog]')&&Boolean(${row("feature-tree-folder/")})`,
		),
	);
	await click("tree:feature-tree-folder/");
	await until(() =>
		evaluate(
			`${row("feature-tree-folder/")}?.getAttribute('aria-expanded')==='true'`,
		),
	);
	await until(()=>evaluate("document.querySelector('button[aria-label=\"New File...\"]')?.disabled===false"));
 await click('button[aria-label="New File..."]');
	await input("nested.txt");
	await click("[role=dialog] button[type=submit]");
	await until(() =>
		evaluate(
			`!document.querySelector('[role=dialog]')&&Boolean(${row("feature-tree-folder/nested.txt")})`,
		),
	);
	assert.ok(await evaluate(`Boolean(${row("feature-native.txt")})`));
	await screenshot("file-tree-expanded-folder-and-sibling");
	await click("tree:feature-tree-folder/nested.txt");
	await until(() =>
		evaluate(
			"Boolean(document.querySelector('[role=tabpanel]:not([hidden]) .cm-content'))",
		),
	);
	await screenshot("file-tree-open-nested-editor");
	await click("text:Close file and discard draft");
	await click('button[aria-label="Collapse All"]');
	await until(() =>
		evaluate(
			`${row("feature-tree-folder/")}?.getAttribute('aria-expanded')==='false'`,
		),
	);
	await click("tree:feature-tree-folder/");
	await until(() =>
		evaluate(
			`${row("feature-tree-folder/")}?.getAttribute('aria-expanded')==='true'`,
		),
	);
	const scope = await evaluate(
		`(async()=>{const job=await window.directWorkstation.getWorkspaceRestore();const view=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=view.targets.find(t=>t.connectionId===view.activeConnectionId);const w=target.workspaces.find(w=>w.tabId===target.activeTabId);const d=job.descriptor;const info=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {descriptor:d,workspaceId:w.workspaceId,root:info.worktreePath};})()`,
	);
	const list = (absolutePath) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path: "filesystem.listDirectory", type: "query", input: { workspaceId: scope.workspaceId, absolutePath } })})`,
		);
	assert.ok(
		(await list(`${scope.root}/feature-tree-folder`)).entries.some(
			(e) => e.name === "nested.txt",
		),
	);
	const point = await evaluate(
		`(()=>{const r=${row("feature-tree-folder/")}?.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
	for (const type of ["mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: "right",
			clickCount: 1,
			...point,
		});
	await until(() =>
		evaluate("Boolean(document.querySelector('[data-file-action=delete]'))"),
	);
	await click("[data-file-action=delete]");
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=dialog]'))"),
	);
	await screenshot("file-tree-delete-folder-confirmation");
	await click("[role=dialog] button[type=submit]");
	await until(() =>
		evaluate(
			`!document.querySelector('[role=dialog]')&&!${row("feature-tree-folder/")}`,
		),
	);
	assert.ok(
		!(await list(scope.root)).entries.some(
			(e) => e.name === "feature-tree-folder",
		),
	);
	await screenshot("file-tree-after-folder-delete");
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-file-tree-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				workspaceId: scope.workspaceId,
				originalTree: true,
				nestedCreation: true,
				siblingsRetained: true,
				collapseAndReopen: true,
				confirmedDirectoryDelete: true,
			},
			null,
			2,
		) + "\n",
	);
}
