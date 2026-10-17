import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationFilePreviewsUi({
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
			const value = await read();
			if (value) return value;
			await delay(50);
		}
		throw new Error(
			`File previews not ready: ${await evaluate("document.body.innerText.slice(-1600)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const t=v.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});})()`,
	);
	const fixture = controls.prepareFilePreviews(
		scope.worktreePath,
		readFileSync(join(output, "restore-three-panes-before.png")),
	);
	await click("text:Files");
	await click("text:Refresh files and Git");
	const treeReady = (path) =>
		until(() =>
			evaluate(
				`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path="${path}"]')`,
			),
		);
	const open = async (path) => {
		await treeReady(path);
		await click(`tree:${path}`);
	};
	const loaded = () =>
		until(() =>
			evaluate(
				`(()=>{const e=document.querySelector('[role=tabpanel]:not([hidden]) [data-remote-image-preview] img');return e?.complete&&e.naturalWidth>0?{src:e.src,width:e.naturalWidth,height:e.naturalHeight,transform:e.parentElement.style.transform,imageBox:e.getBoundingClientRect().toJSON(),surfaceBox:e.closest("[role=application]").getBoundingClientRect().toJSON()}:null;})()`,
			),
		);
	await open("preview.png");
	const first = await loaded();
	assert.deepEqual([first.width, first.height], [1200, 872]);
	assert.ok(first.src.startsWith("blob:"));
	assert.equal(
		await evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden]) .cm-editor')===null",
		),
		true,
	);
	await screenshot("file-preview-original-image");
	writeFileSync(join(output, "file-preview-initial-geometry.json"), JSON.stringify(first, null, 2) + "\n");
	assert.ok(first.imageBox.top >= first.surfaceBox.top - 1 && first.imageBox.bottom <= first.surfaceBox.bottom + 1, "The entire image must fit vertically before zoom");
	assert.ok(first.imageBox.left >= first.surfaceBox.left - 1 && first.imageBox.right <= first.surfaceBox.right + 1, "The entire image must fit horizontally before zoom");
	assert.ok(Math.abs(first.imageBox.width / first.imageBox.height - first.width / first.height) < 0.01, "Fit must preserve image aspect ratio");
	const surface =
		"[role=tabpanel]:not([hidden]) [data-remote-image-preview] [role=application]";
	await click(surface);
	const key = async (key, code) => {
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", { type, key, code });
	};
	await key("+", "Equal");
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden]) [title=\"Reset zoom\"]')?.textContent==='125%'",
		),
	);
	await key("ArrowRight", "ArrowRight");
	const moved = await evaluate(
		"document.querySelector('[role=tabpanel]:not([hidden]) [data-remote-image-preview] img').parentElement.style.transform",
	);
	assert.ok(moved.includes("-50px"));
	const point = await evaluate(
		`(()=>{const e=document.querySelector(${JSON.stringify(surface)}),r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Image surface is covered');return{x,y};})()`,
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...point,
	});
	for (const [x, y] of [
		[35, 15],
		[-20, -10],
		[30, 20],
		[-10, 0],
	])
		await getPage().call("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
			buttons: 1,
			x: point.x + x,
			y: point.y + y,
		});
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		x: point.x - 10,
		y: point.y,
	});
	await screenshot("file-preview-original-pan-and-zoom");
	await key("0", "Digit0");
	await until(() =>
		evaluate(
			"!document.querySelector('[role=tabpanel]:not([hidden]) [title=\"Reset zoom\"]')",
		),
	);
	await open("unknown-preview.bin");
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden])')?.innerText.includes('Binary files cannot be edited here.')",
		),
	);
	assert.equal(
		await evaluate(
			"!!document.querySelector('[role=tabpanel]:not([hidden]) img, [role=tabpanel]:not([hidden]) .cm-editor')",
		),
		false,
	);
	await screenshot("file-preview-unknown-binary-read-only");
	await open("oversized-preview.png");
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden])')?.innerText.includes('This preview is truncated. Saving is disabled.')",
		),
	);
	assert.equal(
		await evaluate(
			"(()=>{const e=[...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].find(e=>e.textContent.trim()==='Save file');return e?.disabled===true&&!document.querySelector('[role=tabpanel]:not([hidden]) img');})()",
		),
		true,
	);
	await screenshot("file-preview-size-limit");
	await open("corrupt-preview.png");
	await until(() =>
		evaluate(
			"document.querySelector('[role=tabpanel]:not([hidden]) [role=alert]')?.innerText==='Failed to load image'",
		),
	);
	await screenshot("file-preview-corrupt-image-visible-error");
	await open("preview.png");
	await loaded();
	await closeReopen();
	await until(() =>
		evaluate(
			"window.directWorkstation.getWorkspaceRestore().then(v=>v.status==='ready')",
		),
	);
	await click("text:Files");
	await open("preview.png");
	const restored = await loaded();
	assert.deepEqual(
		[restored.width, restored.height],
		[first.width, first.height],
	);
	await screenshot("file-preview-image-after-window-reopen");
	await click("text:Terminal");
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-file-previews-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalImageView: true,
				...fixture,
				dimensions: [first.width, first.height],
				keyboardZoom: true,
				keyboardPan: true,
				pointerPan: true,
				reset: true,
				unknownBinaryReadOnly: true,
				sizeLimitEnforced: true,
				corruptImageVisibleError: true,
				windowReopenImageLoaded: true,
				markdownVerified: false,
				pdfVideoVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
