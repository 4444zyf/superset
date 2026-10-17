import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export async function verifyWorkstationCloseGuardUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	requestClose,
	controls,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		try {
			for (let i = 0; i < 200; i++) {
				const value = await read();
				if (value) return value;
				await delay(50);
			}
		} catch (error) {
			writeFileSync(
				join(output, "close-guard-failure-error.json"),
				JSON.stringify({ error: String(error) }, null, 2) + "\n",
			);
		}
		await screenshot("close-guard-failure").catch(() => {});
		throw new Error("Window close guard acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const {descriptor:d}=await window.directWorkstation.getWorkspaceRestore();const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId);const w=t.workspaces.find(w=>w.tabId===t.activeTabId);const info=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {connectionId:d.connectionId,workspaceId:w.workspaceId,root:info.worktreePath};})()`,
	);
	assert.ok(
		scope.root.includes(".superset-ssh-test-") &&
			scope.root.includes("Superset Remix/worktrees/"),
	);
	const originalTerminals = await controls.verifyWorktreeLocation(scope.root);
	const path = join(scope.root, "close-guard-native.txt");
	const original = "original saved disk\r\n";
	writeFileSync(path, original);
	const editorText = () =>
		evaluate(
			"[...document.querySelectorAll('[role=tabpanel]:not([hidden]) .cm-content .cm-line')].map(e=>e.textContent).join('\\n')",
		);
	const open = async () => {
		await click("text:Files");
		await until(() =>
			evaluate(
				"Boolean(document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path=\"close-guard-native.txt\"]'))",
			),
		);
		await click("tree:close-guard-native.txt");
		await until(() =>
			evaluate(
				"document.querySelector('[role=tabpanel]:not([hidden]) .cm-content')?.getAttribute('contenteditable')==='true'",
			),
		);
	};
	const replace = async (text) => {
		await click(
			"[role=tabpanel]:not([hidden]) .cm-content[contenteditable=true]",
		);
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key: "a",
				code: "KeyA",
				windowsVirtualKeyCode: 65,
				modifiers: process.platform === "darwin" ? 4 : 2,
				commands: ["selectAll"],
			});
		await getPage().call("Input.insertText", { text });
		await until(async () => (await editorText()) === text);
	};
	const dialog = () =>
		until(() =>
			evaluate(
				"document.querySelector('[role=alertdialog]')?.textContent.includes('Unsaved changes')",
			),
		);
	const restored = () =>
		until(() =>
			evaluate(
				`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
			),
		);
	await open();
	const savedDraft = "explicit Save All 中文🙂\n";
	await replace(savedDraft);
	await click("text:Terminal");
	await screenshot("close-guard-background-draft-before-window-close");
	await requestClose("window");
	await dialog();
	assert.equal(readFileSync(path, "utf8"), original);
	await screenshot("close-guard-original-dialog-window-close");
	await click("text:Cancel");
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	assert.deepEqual(
		await controls.verifyWorktreeLocation(scope.root),
		originalTerminals,
	);
	await requestClose("both");
	await dialog();
	assert.equal(
		await evaluate("document.querySelectorAll('[role=alertdialog]').length"),
		1,
	);
	await click("text:Cancel");
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	await open();
	assert.equal(await editorText(), savedDraft);
	assert.equal(readFileSync(path, "utf8"), original);
	await click("text:Terminal");
	await requestClose("quit");
	await dialog();
	await screenshot("close-guard-before-explicit-save-all");
	await click("text:Save All");
	const saved = savedDraft.replaceAll("\n", "\r\n");
	await until(() => readFileSync(path, "utf8") === saved);
	await closeReopen(true);
	await restored();
	await open();
	await until(async () => (await editorText()) === savedDraft);
	assert.equal(readFileSync(path, "utf8"), saved);
	assert.deepEqual(
		await controls.verifyWorktreeLocation(scope.root),
		originalTerminals,
	);
	await screenshot("close-guard-saved-and-reopened");
	const rejectedDraft = "keep draft after refused exit save 中文\n";
	await replace(rejectedDraft);
	await click("text:Terminal");
	await requestClose("quit");
	await dialog();
	const newer = "newer external disk\r\n";
	writeFileSync(path, newer);
	await click("text:Save All");
	await until(() =>
		evaluate(
			"document.querySelector('[role=alertdialog] [role=alert]')?.textContent.includes('File changed on disk')",
		),
	);
	assert.equal(readFileSync(path, "utf8"), newer);
	await screenshot("close-guard-conflict-keeps-window-and-dialog");
	await click("text:Cancel");
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	await open();
	await until(() =>
		evaluate(
			"document.querySelector('[role=dialog] h2')?.textContent==='File changed on disk'",
		),
	);
	await click("text:Keep editing");
	assert.equal(await editorText(), rejectedDraft);
	assert.equal(readFileSync(path, "utf8"), newer);
	await screenshot("close-guard-conflict-draft-still-present");
	await click("text:Terminal");
	await requestClose("window");
	await dialog();
	await screenshot("close-guard-before-explicit-dont-save");
	await click("text:Don't Save");
	await closeReopen(true);
	await restored();
	await open();
	await until(
		async () => (await editorText()) === newer.replaceAll("\r\n", "\n"),
	);
	assert.equal(readFileSync(path, "utf8"), newer);
	assert.deepEqual(
		await controls.verifyWorktreeLocation(scope.root),
		originalTerminals,
	);
	assert.deepEqual(getPage().errors, []);
	await screenshot("close-guard-discarded-and-reopened-without-write");
	writeFileSync(
		join(output, "workstation-close-guard-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				scope,
				closeSource:
					"owned BrowserWindow.close/app.quit lifecycle events; actual CDP keyboard input and visible original dialog buttons",
				backgroundDraftGuarded: true,
				explicitCancelKeepsWindowDraftAndTerminals: true,
				concurrentWindowAndQuitCoalesced: true,
				explicitSaveAllPreservesCRLF: true,
				conflictKeepsWindowAndDraft: true,
				explicitDontSaveDoesNotWriteDisk: true,
				reopenWithoutWrite: true,
				originalTerminalsRetained: originalTerminals.terminals,
				macOSVerified: false,
				vendorAgentVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
