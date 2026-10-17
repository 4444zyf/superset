import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationMarkdownUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	controls,
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
			`Markdown acceptance did not become ready: ${await evaluate("document.body.innerText.slice(-1800)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const t=v.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});})()`,
	);
	const fixture = controls.prepareMarkdownPreview(
		scope.worktreePath,
		readFileSync(join(output, "restore-three-panes-before.png")),
	);
	const disk = async () => {
		const r = await evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'filesystem.readFile',type:'query',input:{workspaceId:${JSON.stringify(scope.id)},absolutePath:${JSON.stringify(scope.worktreePath + "/README.md")},maxBytes:65536}});})()`,
		);
		return {
			text: Buffer.from(
				r.content,
				r.kind === "text" ? "utf8" : "base64",
			).toString("utf8"),
			revision: r.revision,
		};
	};
	const key = async (key, code, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				modifiers,
			});
	};
	const panel = "[role=tabpanel]:not([hidden])";
	const source = async () => {
		await click(`${panel} button[title=Markdown]`);
		await until(() =>
			evaluate(`!!document.querySelector('${panel} .cm-editor')`),
		);
	};
	const preview = async () => {
		await click(`${panel} button[title=Preview]`);
		await until(() =>
			evaluate(
				`document.querySelector('${panel} .markdown-renderer h1')?.textContent==='SSH markdown'`,
			),
		);
	};
	await click("text:Files");
	await click("text:Refresh files and Git");
	await until(() =>
		evaluate(
			"!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path=\"README.md\"]')",
		),
	);
	await click("tree:README.md");
	await until(() =>
		evaluate(
			`document.querySelector('${panel} .markdown-renderer h1')?.textContent==='SSH markdown'`,
		),
	);
	const image = await until(() =>
		evaluate(
			`(()=>{const e=document.querySelector('${panel} .markdown-renderer img[alt="Remote plot"]');return e?.complete&&e.naturalWidth?{src:e.src,width:e.naturalWidth,height:e.naturalHeight}:null;})()`,
		),
	);
	assert.ok(image.src.startsWith("blob:"));
	assert.deepEqual([image.width, image.height], [1200, 872]);
	assert.equal(
		await evaluate(
			`document.querySelectorAll('${panel} .markdown-renderer table tr').length`,
		),
		2,
	);
	assert.equal((await disk()).text, fixture.source);
	await screenshot("markdown-original-rich-preview-and-remote-image");
	await source();
	await click(`${panel} .cm-content`);
	await key(
		process.platform === "darwin" ? "ArrowDown" : "End",
		process.platform === "darwin" ? "ArrowDown" : "End",
		process.platform === "darwin" ? 4 : 2,
	);
	await getPage().call("Input.insertText", { text: "\nSource edit 中文.\n" });
	await until(() =>
		evaluate(
			`document.querySelector('${panel} .cm-content')?.textContent.includes('Source edit 中文.')`,
		),
	);
	assert.equal((await disk()).text, fixture.source);
	await preview();
	await until(() =>
		evaluate(
			`document.querySelector('${panel} .markdown-renderer')?.textContent.includes('Source edit 中文.')`,
		),
	);
	await screenshot("markdown-source-draft-shared-with-preview");
	const p = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('${panel} .tiptap p')].find(e=>e.textContent==='Original paragraph.');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "left",
			clickCount: type === "mouseMoved" ? 0 : 1,
			...p,
		});
	await key(
		process.platform === "darwin" ? "ArrowRight" : "End",
		process.platform === "darwin" ? "ArrowRight" : "End",
		process.platform === "darwin" ? 4 : 0,
	);
	await getPage().call("Input.insertText", { text: " Rich edit 中文🙂." });
	await until(() =>
		evaluate(
			`document.querySelector('${panel} .tiptap')?.textContent.includes('Rich edit 中文🙂.')`,
		),
	);
	assert.equal((await disk()).text, fixture.source);
	await source();
	await until(() =>
		evaluate(
			`document.querySelector('${panel} .cm-content')?.textContent.includes('Rich edit 中文🙂.')`,
		),
	);
	await screenshot("markdown-rich-draft-shared-with-source");
	const save = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('${panel} button')].find(e=>e.textContent.trim()==='Save file');if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "left",
			clickCount: type === "mouseMoved" ? 0 : 1,
			...save,
		});
	const saved = await until(async () => {
		const r = await disk();
		return r.text.includes("Rich edit 中文🙂.") &&
			r.text.includes("Source edit 中文.")
			? r
			: null;
	});
	assert.ok(saved.text.startsWith('---\ntitle: "Keep literal quotes"\n---\n'));
	assert.ok(
		saved.text.includes("| Name | Value |\n| ---- | ----- |\n| Local | SSH |"),
	);
	assert.ok(saved.text.includes("```js\nconst count = 1;\n```"));
	writeFileSync(join(output,"markdown-save-checkpoint.json"),JSON.stringify({saved,explicitSaveOnly:true,frontMatterPreserved:true,tableSourcePreserved:true,codeSourcePreserved:true},null,2)+"\n");
	await preview();
	await until(() => evaluate(`!!document.querySelector('${panel} .tiptap')`));
	await click(`${panel} .tiptap h1`);
	await key("f", "KeyF", process.platform === "darwin" ? 4 : 2);
	await until(() =>
		evaluate(`!!document.querySelector('${panel} input[aria-label=Find]')`),
	);
	await getPage().call("Input.insertText", { text: "Original" });
	await until(() =>
		evaluate(
			`document.querySelector('${panel} [data-remote-markdown-preview]')?.innerText.includes('1 of 1')`,
		),
	);
	await screenshot("markdown-original-search");
	await key("Escape", "Escape");
	await until(() => evaluate(`!document.querySelector('${panel} input[aria-label=Find]')`));
	await key("f", "KeyF", process.platform === "darwin" ? 4 : 2);
	await until(() => evaluate(`!!document.querySelector('${panel} input[aria-label=Find]')`));
	await key("Escape", "Escape");
	await closeReopen();
	await until(() =>
		evaluate(
			"window.directWorkstation.getWorkspaceRestore().then(v=>v.status==='ready')",
		),
	);
	await click("text:Files");
	await until(() =>
		evaluate(
			"!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path=\"README.md\"]')",
		),
	);
	await click("tree:README.md");
	await until(() =>
		evaluate(
			`document.querySelector('${panel} .markdown-renderer')?.textContent.includes('Rich edit 中文🙂.')`,
		),
	);
	assert.equal((await disk()).text, saved.text);
	await screenshot("markdown-saved-content-after-window-reopen");
	await click("text:Terminal");
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-markdown-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalTipTapSurface: true,
				originalViewToggle: true,
				sharedSourceAndRichDraft: true,
				explicitSaveOnly: true,
				frontMatterPreserved: true,
				tableSourcePreserved: true,
				codeSourcePreserved: true,
				remoteImage: image,
				originalSearch: true,
			searchFocusRestored: true,
				windowReopenSavedContent: true,
				savedFile: saved,
				osExternalBrowserVerified: false,
				macOSVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
