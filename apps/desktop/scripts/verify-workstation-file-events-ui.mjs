import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationFileEventsUi({
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
		await screenshot("file-events-failure");
		writeFileSync(
			join(output, "file-events-failure-observations.json"),
			JSON.stringify(
				await evaluate(
					"({events:window.nativeFileEvents??[],text:document.body.innerText.slice(-3000)})",
				),
				null,
				2,
			) + "\n",
		);
		throw new Error("Remote file events acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const {descriptor:d}=await window.directWorkstation.getWorkspaceRestore();const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId);const w=t.workspaces.find(w=>w.tabId===t.activeTabId);const info=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {connectionId:d.connectionId,workspaceId:w.workspaceId,root:info.worktreePath,capability:d.capabilities?.workstationFileEventsV1===true};})()`,
	);
	assert.ok(controls?.verifyWorktreeLocation);
	assert.ok(
		scope.root.includes(".superset-ssh-test-") &&
			scope.root.includes("Superset Remix/worktrees/"),
	);
	const originalTerminals = await controls.verifyWorktreeLocation(scope.root);
	const target = join(scope.root, "watch-native.txt"),
		folder = join(scope.root, "watch-native-dir"),
		renamed = join(scope.root, "watch-native-renamed"),
		ignored = join(scope.root, "watch-ignored");
	const ignorePath = join(scope.root, ".gitignore");
	const originalIgnore = existsSync(ignorePath)
		? readFileSync(ignorePath)
		: null;
	writeFileSync(
		ignorePath,
		Buffer.concat([
			originalIgnore ?? Buffer.alloc(0),
			Buffer.from("\nwatch-ignored/\n"),
		]),
	);
	mkdirSync(ignored, { mode: 0o700 });
	writeFileSync(join(ignored, "note.txt"), "ignored original\n");
	writeFileSync(target, "external original\n");
	const row = (path) =>
		`document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path='+${JSON.stringify(JSON.stringify(path))}+']:not([data-file-tree-sticky-row])')`;
	const editorText = () =>
		evaluate(
			"[...document.querySelectorAll('[role=tabpanel]:not([hidden]) .cm-content .cm-line')].map(e=>e.textContent).join('\\n')",
		);
	const editorPath = () =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden]) > code')?.textContent",
		);
	const open = async (path) => {
		await until(() => evaluate(`Boolean(${row(path)})`));
		await click(`tree:${path}`);
		if (path.endsWith("/")) return;
		await until(() =>
			evaluate(
				"Boolean(document.querySelector('[role=tabpanel]:not([hidden]) .cm-content'))",
			),
		);
	};
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await click("text:Files");
	await open("watch-native.txt");
	await until(async () => (await editorText()) === "external original\n");
	await evaluate(
		`(()=>{window.nativeFileEvents=[];window.nativeFileEventsOff=window.directWorkstation.onSocket(e=>{if(e.kind!=='message'||typeof e.data!=='string'||e.data.length>1048576)return;let m;try{m=JSON.parse(e.data)}catch{return}if(m?.type==='fs:events'&&m.workspaceId===${JSON.stringify(scope.workspaceId)}&&window.nativeFileEvents.length<100)window.nativeFileEvents.push(m);});return true;})()`,
	);
	await screenshot("file-events-before-external-update");
	const second = "external update 中文🙂\n";
	writeFileSync(target, second);
	await until(async () => (await editorText()) === second);
	assert.equal(scope.capability, true);
	await screenshot("file-events-clean-editor-updated");
	mkdirSync(folder, { mode: 0o700 });
	writeFileSync(join(folder, "child.txt"), "child from external agent\n");
	await open("watch-native-dir/");
	await open("watch-native-dir/child.txt");
	await until(
		async () => (await editorText()) === "child from external agent\n",
	);
	renameSync(folder, renamed);
	await until(() =>
		evaluate(
			`Boolean(${row("watch-native-renamed/")})&&!${row("watch-native-dir/")}`,
		),
	);
	const automaticDirectoryRetarget =
		(await editorPath()) === join(renamed, "child.txt");
	await open("watch-native-renamed/");
	await open("watch-native-renamed/child.txt");
	await until(async () => (await editorPath()) === join(renamed, "child.txt"));
	rmSync(renamed, { recursive: true });
	await until(() => evaluate(`!${row("watch-native-renamed/")}`));
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('File was deleted on disk.')",
		),
	);
	await screenshot("file-events-deleted-directory-editor");
	await click("text:Close file and discard draft");
	await open("watch-native.txt");
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
	const draft = "unsaved from client 🙂";
	await getPage().call("Input.insertText", { text: draft });
	await until(async () => (await editorText()) === draft);
	const disk = "external agent conflicting revision\n";
	const beforeConflictEvents = await evaluate("window.nativeFileEvents.length");
	writeFileSync(target, disk);
	await until(() =>
		evaluate(
			`window.nativeFileEvents.slice(${beforeConflictEvents}).some(m=>m.events.some(e=>e.absolutePath===${JSON.stringify(target)}&&e.kind==='update'))`,
		),
	);
	assert.equal(await editorText(), draft);
	await click("text:Save file");
	await until(() =>
		evaluate(
			"document.body.innerText.includes('Your draft is preserved; reload before saving')",
		),
	);
	assert.equal(await editorText(), draft);
	assert.equal(readFileSync(target, "utf8"), disk);
	await screenshot("file-events-conflict-keeps-draft-and-disk");
	await click("text:Close file and discard draft");
	await until(async () => await editorPath() !== target);
	assert.equal(readFileSync(target, "utf8"), disk);
	await open("watch-ignored/");
	await open("watch-ignored/note.txt");
	await until(async () => (await editorText()) === "ignored original\n");
	const ignoredUpdated = "ignored external update 中文\n";
	writeFileSync(join(ignored, "note.txt"), ignoredUpdated);
	await until(async () => (await editorText()) === ignoredUpdated);
	await screenshot("file-events-pruned-open-file-updated");
	const events = await evaluate("window.nativeFileEvents");
	assert.ok(
		events.some((m) =>
			m.events.some((e) => e.absolutePath === join(ignored, "note.txt")),
		),
	);
	writeFileSync(join(output, "file-events-before-reopen-observations.json"), JSON.stringify({events, automaticDirectoryRetarget}, null, 2) + "\n");
	await evaluate("window.nativeFileEventsOff?.();true");
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await click("text:Files");
	await open("watch-ignored/");
	await open("watch-ignored/note.txt");
	await until(async () => (await editorText()) === ignoredUpdated);
	await screenshot("file-events-reopened-without-write");
	assert.equal(readFileSync(target, "utf8"), disk);
	const retained = await controls.verifyWorktreeLocation(scope.root);
	assert.deepEqual(retained, originalTerminals);
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-file-events-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				scope,
				externalMutationSource:
					"owned fixture filesystem on the SSH runtime host",
				originalTreeAndEditor: true,
				cleanExternalUpdate: true,
				externalDirectoryRenameVisible: true,
				automaticDirectoryRetarget,
				deletedDirectoryMarksOpenFile: true,
				unsavedDraftAndRemoteRevisionPreserved: true,
				explicitSaveConflict: true,
				prunedOpenFileUpdated: true,
				reopenWithoutWrite: true,
				originalTerminalsRetained: retained.terminals,
				events,
				macOSVerified: false,
				vendorAgentVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
