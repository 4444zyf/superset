import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationFileConflictUi({
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
		await screenshot("file-conflict-failure");
		writeFileSync(
			join(output, "file-conflict-failure-observations.json"),
			JSON.stringify(
				await evaluate(
					"({text:document.body.innerText.slice(-3500),dialog:document.querySelector('[role=dialog]')?.textContent})",
				),
				null,
				2,
			) + "\n",
		);
		throw new Error("File conflict acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const {descriptor:d}=await window.directWorkstation.getWorkspaceRestore();const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId);const w=t.workspaces.find(w=>w.tabId===t.activeTabId);const info=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});const p=await window.directWorkstation.getPreferences();return {connectionId:d.connectionId,workspaceId:w.workspaceId,root:info.worktreePath,autoSave:p.values.fileAutoSave};})()`,
	);
	assert.ok(
		scope.root.includes(".superset-ssh-test-") &&
			scope.root.includes("Superset Remix/worktrees/"),
	);
	assert.equal(scope.autoSave, "off");
	assert.ok(process.getuid?.() > 0);
	const originalTerminals = await controls.verifyWorktreeLocation(scope.root);
	const path = join(scope.root, "conflict-native.txt");
	const original = "original disk\r\nsecond line\r\n";
	writeFileSync(path, original);
	const row = (relative) =>
		`document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path='+${JSON.stringify(JSON.stringify(relative))}+']:not([data-file-tree-sticky-row])')`;
	const editorText = () =>
		evaluate(
			"[...document.querySelectorAll('[role=tabpanel]:not([hidden]) .cm-content .cm-line')].map(e=>e.textContent).join('\\n')",
		);
	const open = async (relative) => {
		await until(() => evaluate(`Boolean(${row(relative)})`));
		await click(`tree:${relative}`);
		if (!relative.endsWith("/"))
			await until(() =>
				evaluate(
					"Boolean(document.querySelector('[role=tabpanel]:not([hidden]) .cm-content'))",
				),
			);
	};
	const replace = async (text) => {
		await click("[role=tabpanel]:not([hidden]) .cm-content");
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
				"document.querySelector('[role=dialog] h2')?.textContent==='File changed on disk'",
			),
		);
	const noDialog = () =>
		until(() => evaluate("!document.querySelector('[role=dialog]')"));
	const compare = async () => {
		await until(() =>
			evaluate(
				"document.body.innerText.includes('The file changed on disk. Review it before saving again.')",
			),
		);
		await click("text:Compare");
		await dialog();
	};
	const deepDialogText = () =>
		evaluate(
			"(()=>{const text=[];const walk=n=>{if(n.nodeType===3){text.push(n.textContent);return;}if(n.nodeType===1&&['STYLE','SCRIPT'].includes(n.tagName))return;for(const child of n.childNodes??[])walk(child);if(n.shadowRoot)walk(n.shadowRoot);};walk(document.querySelector('[role=dialog]'));return text.join('');})()",
		);
	await open("conflict-native.txt");
	await until(
		async () => (await editorText()) === original.replaceAll("\r\n", "\n"),
	);
	const retainedDraft = "local draft 中文🙂\nkept on Keep editing\n";
	await replace(retainedDraft);
	const external = "agent disk version\r\nchanged separately\r\n";
	writeFileSync(path, external);
	await screenshot("file-conflict-before-compare");
	await compare();
	await until(async () => {
		const text = await deepDialogText();
		return (
			text.includes("agent disk version") && text.includes("local draft 中文")
		);
	});
	const diffText = await deepDialogText();
	await screenshot("file-conflict-original-diff-and-actions");
	await click("text:Keep editing");
	await noDialog();
	assert.equal(await editorText(), retainedDraft);
	assert.equal(readFileSync(path, "utf8"), external);
	await compare();
	await click("text:Reload from disk");
	await noDialog();
	await until(
		async () => (await editorText()) === external.replaceAll("\r\n", "\n"),
	);
	assert.equal(readFileSync(path, "utf8"), external);
	await screenshot("file-conflict-explicit-reload");
	const overwriteDraft = "explicit overwrite 中文🙂\nline two\n";
	await replace(overwriteDraft);
	const newer = "newer external version\r\n";
	writeFileSync(path, newer);
	await compare();
	assert.equal(readFileSync(path, "utf8"), newer);
	await click("text:Overwrite file");
	await noDialog();
	const overwritten = overwriteDraft.replaceAll("\n", "\r\n");
	await until(() => readFileSync(path, "utf8") === overwritten);
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Save file')?.disabled===true",
		),
	);
	assert.equal(await editorText(), overwriteDraft);
	await screenshot("file-conflict-explicit-overwrite-crlf");
	const recreatedDraft = "recreated draft 中文\n";
	await replace(recreatedDraft);
	unlinkSync(path);
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('File was deleted on disk. You still have unsaved changes.')",
		),
	);
	await click("text:Save file");
	await dialog();
	assert.equal(existsSync(path), false);
	await screenshot("file-conflict-deleted-file-before-recreate");
	await click("text:Overwrite file");
	await noDialog();
	const recreated = recreatedDraft.replaceAll("\n", "\r\n");
	await until(
		() => existsSync(path) && readFileSync(path, "utf8") === recreated,
	);
	await until(() =>
		evaluate(
			"!document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('File was deleted on disk.')",
		),
	);
	await screenshot("file-conflict-explicit-recreate");
	const failedDirectory = join(scope.root, "conflict-save-failure");
	const failedFile = join(failedDirectory, "retry.txt");
	mkdirSync(failedDirectory, { mode: 0o700 });
	writeFileSync(failedFile, "before retry\r\n");
	await open("conflict-save-failure/");
	await open("conflict-save-failure/retry.txt");
	await until(async () => (await editorText()) === "before retry\n");
	const retryDraft = "saved only after explicit Retry\n";
	await replace(retryDraft);
	try {
		chmodSync(failedDirectory, 0o500);
		await click("text:Save file");
		await until(() =>
			evaluate(
				"document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('Save failed:')",
			),
		);
		assert.equal(readFileSync(failedFile, "utf8"), "before retry\r\n");
		assert.equal(await editorText(), retryDraft);
		await screenshot("file-conflict-original-save-error-banner");
	} finally {
		chmodSync(failedDirectory, 0o700);
	}
	assert.equal(readFileSync(failedFile, "utf8"), "before retry\r\n");
	await click("text:Retry");
	await until(
		() =>
			readFileSync(failedFile, "utf8") === retryDraft.replaceAll("\n", "\r\n"),
	);
	await until(() =>
		evaluate(
			"!document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('Save failed:')",
		),
	);
	await screenshot("file-conflict-explicit-retry-saved");
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await click("text:Files");
	await open("conflict-native.txt");
	await until(async () => (await editorText()) === recreatedDraft);
	assert.equal(readFileSync(path, "utf8"), recreated);
	assert.equal(
		readFileSync(failedFile, "utf8"),
		retryDraft.replaceAll("\n", "\r\n"),
	);
	await screenshot("file-conflict-reopened-without-write");
	const retained = await controls.verifyWorktreeLocation(scope.root);
	assert.deepEqual(retained, originalTerminals);
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-file-conflict-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				scope,
				physicalInput: true,
				externalMutationSource: "owned fixture files on the SSH runtime host",
				originalConflictDialog: true,
				originalDiffText: diffText,
				keepEditingPreservesDraftAndDisk: true,
				explicitReload: true,
				explicitOverwrite: true,
				crlfPreserved: true,
				explicitRecreateDeletedFile: true,
				realPermissionFailureKeepsDraft: true,
				originalSaveErrorBanner: true,
				explicitRetryOnly: true,
				reopenWithoutWrite: true,
				originalTerminalsRetained: retained.terminals,
				macOSVerified: false,
				vendorAgentVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
