import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export async function verifyWorkstationBackgroundFilesUi({
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
		await screenshot("background-files-failure");
		writeFileSync(
			join(output, "background-files-failure-observations.json"),
			JSON.stringify(
				await evaluate(
					"({events:window.nativeBackgroundEvents??[],text:document.body.innerText.slice(-4000)})",
				),
				null,
				2,
			) + "\n",
		);
		throw new Error("Background file acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const {descriptor:d}=await window.directWorkstation.getWorkspaceRestore();const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId);const w=t.workspaces.find(w=>w.tabId===t.activeTabId);const info=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {connectionId:d.connectionId,workspaceId:w.workspaceId,root:info.worktreePath};})()`,
	);
	assert.ok(
		scope.root.includes(".superset-ssh-test-") &&
			scope.root.includes("Superset Remix/worktrees/"),
	);
	const originalTerminals = await controls.verifyWorktreeLocation(scope.root);
	const directory = join(scope.root, "background-original");
	const renamed = join(scope.root, "background-renamed");
	mkdirSync(directory, { mode: 0o700 });
	writeFileSync(join(directory, "note.txt"), "before background rename\n");
	await evaluate(
		`(()=>{window.nativeBackgroundEvents=[];window.nativeBackgroundOff=window.directWorkstation.onSocket(e=>{if(e.kind!=='message'||typeof e.data!=='string')return;try{const m=JSON.parse(e.data);if(m.type==='fs:events'&&m.workspaceId===${JSON.stringify(scope.workspaceId)})window.nativeBackgroundEvents.push(...m.events);}catch{}});return true;})()`,
	);
	const row = (relative) =>
		`document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path='+${JSON.stringify(JSON.stringify(relative))}+']:not([data-file-tree-sticky-row])')`;
	const editorText = () =>
		evaluate(
			"[...document.querySelectorAll('[role=tabpanel]:not([hidden]) .cm-content .cm-line')].map(e=>e.textContent).join('\\n')",
		);
	const open = async (relative) => {
		await until(() => evaluate(`Boolean(${row(relative)})`));
		await click(`tree:${relative}`);
	};
	await open("background-original/");
	await open("background-original/note.txt");
	await until(
		async () => (await editorText()) === "before background rename\n",
	);
	await click("text:Terminal");
	assert.equal(
		await evaluate("Boolean(document.querySelector('file-tree-container'))"),
		false,
	);
	renameSync(directory, renamed);
	await until(() =>
		evaluate(
			`window.nativeBackgroundEvents.some(e=>e.kind==='rename'&&e.oldAbsolutePath===${JSON.stringify(directory)}&&e.absolutePath===${JSON.stringify(renamed)})`,
		),
	);
	await screenshot("background-files-terminal-received-rename");
	await click("text:Files");
	await until(() =>
		evaluate(
			`document.querySelector('[role=tabpanel]:not([hidden]) > code')?.textContent===${JSON.stringify(join(renamed, "note.txt"))}`,
		),
	);
	assert.equal(await editorText(), "before background rename\n");
	await screenshot("background-files-returned-to-retargeted-document");
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
	const draft = "private background draft 中文🙂\n";
	await getPage().call("Input.insertText", { text: draft });
	await until(async () => (await editorText()) === draft);
	await click("text:Terminal");
	writeFileSync(
		join(renamed, "note.txt"),
		"external while terminal is visible\n",
	);
	await until(() =>
		evaluate(
			`window.nativeBackgroundEvents.some(e=>e.kind==='update'&&e.absolutePath===${JSON.stringify(join(renamed, "note.txt"))})`,
		),
	);
	await click("text:Files");
	await until(async () => (await editorText()) === draft);
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden])')?.textContent.includes('The file changed on disk. Review it before saving again.')",
		),
	);
	assert.equal(
		readFileSync(join(renamed, "note.txt"), "utf8"),
		"external while terminal is visible\n",
	);
	await screenshot("background-files-dirty-draft-kept");
	await click("text:Close file and discard draft");
	await until(() =>
		evaluate(
			`document.querySelector('[role=tabpanel]:not([hidden]) > code')?.textContent!==${JSON.stringify(join(renamed, "note.txt"))}`,
		),
	);
	const ignored = join(scope.root, "background-images");
	mkdirSync(ignored, { mode: 0o700 });
	const ignorePath = join(scope.root, ".gitignore");
	const ignore = existsSync(ignorePath)
		? readFileSync(ignorePath)
		: Buffer.alloc(0);
	writeFileSync(
		ignorePath,
		Buffer.concat([ignore, Buffer.from("\nbackground-images/\n")]),
	);
	const icon = (size) =>
		readFileSync(
			fileURLToPath(
				new URL(`../../../assets/branding/icon-${size}.png`, import.meta.url),
			),
		);
	const imagePath = join(ignored, "screenshot.png");
	writeFileSync(imagePath, icon(128));
	const markdownPath = join(scope.root, "background-preview.md");
	const markdown =
		"# Independent image resource\n\n![Runtime image](./background-images/screenshot.png)\n\nKeep this source unchanged.\n";
	writeFileSync(markdownPath, markdown);
	await open("background-preview.md");
	const dimensions = () =>
		evaluate(
			"(()=>{const img=document.querySelector('[data-remote-markdown-preview] img');return img&&img.complete?{width:img.naturalWidth,height:img.naturalHeight,src:img.src}:null;})()",
		);
	const initial = await until(async () => {
		const image = await dimensions();
		return image?.width === 128 && image.height === 128 ? image : null;
	});
	await screenshot("background-images-original");
	writeFileSync(imagePath, icon(32));
	const replacement = await until(async () => {
		const image = await dimensions();
		return image?.width === 32 && image.height === 32 ? image : null;
	});
	assert.notEqual(replacement.src, initial.src);
	assert.equal(readFileSync(markdownPath, "utf8"), markdown);
	await screenshot("background-images-independent-update");
	unlinkSync(imagePath);
	await until(() =>
		evaluate(
			"document.querySelector('[data-remote-markdown-preview]')?.textContent.includes('Could not load image')",
		),
	);
	await screenshot("background-images-deleted-resource");
	writeFileSync(imagePath, icon(24));
	const recreated = await until(async () => {
		const image = await dimensions();
		return image?.width === 24 && image.height === 24 ? image : null;
	});
	assert.equal(readFileSync(markdownPath, "utf8"), markdown);
	await screenshot("background-images-recreated-resource");
	const events = await evaluate("window.nativeBackgroundEvents");
	await evaluate("window.nativeBackgroundOff?.();true");
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await click("text:Files");
	await open("background-preview.md");
	await until(async () => {
		const image = await dimensions();
		return image?.width === 24 && image.height === 24;
	});
	assert.equal(readFileSync(markdownPath, "utf8"), markdown);
	assert.equal(
		readFileSync(join(renamed, "note.txt"), "utf8"),
		"external while terminal is visible\n",
	);
	const retained = await controls.verifyWorktreeLocation(scope.root);
	assert.deepEqual(retained, originalTerminals);
	assert.deepEqual(getPage().errors, []);
	await screenshot("background-files-reopened-without-write");
	writeFileSync(
		join(output, "workstation-background-files-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				scope,
				physicalInput: true,
				externalMutationSource: "owned SSH runtime host fixture files",
				backgroundRenameReceivedBeforeFileViewReturned: true,
				originalDocumentRetargeted: true,
				backgroundDirtyDraftPreserved: true,
				markdownSourceUnchanged: true,
				independentImageUpdate: replacement,
				deletedImageError: true,
				recreatedImage: recreated,
				events,
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
