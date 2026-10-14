import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationMultipleFilesUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let i = 0; i < 150; i++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error(
			`Multiple file UI did not complete: ${await evaluate("document.body.innerText.slice(-1400)")}`,
		);
	};
	const show = async (selector) => {
		for (let i = 0; i < 15; i++) {
			const value = await evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();const p=document.querySelector('[data-workspace-files]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,top:p.top,bottom:p.bottom,px:p.x+p.width/2,py:p.y+p.height/2};})()`,
			);
			assert.ok(value, selector);
			if (value.y > value.top + 5 && value.y < value.bottom - 5) return;
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: value.px,
				y: value.py,
				deltaX: 0,
				deltaY: value.y < value.top ? -360 : 360,
			});
			await delay(50);
		}
		throw new Error(`Input clipped: ${selector}`);
	};
	const input = async (selector, text) => {
		await show(selector);
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
	const editor = "[role=tabpanel]:not([hidden]) .cm-content";
	const text = () =>
		evaluate(
			`[...document.querySelectorAll('${editor} .cm-line')].map(e=>e.textContent).join('\\n')`,
		);
	const scope = await evaluate(
		`(async()=>{const job=await window.directWorkstation.getWorkspaceRestore();const view=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=view.targets.find(t=>t.connectionId===view.activeConnectionId);const workspace=target.workspaces.find(w=>w.tabId===target.activeTabId);const d=job.descriptor;const info=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:workspace.workspaceId}});return {descriptor:d,workspaceId:workspace.workspaceId,root:info.worktreePath};})()`,
	);
	const read = (name) =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path: "filesystem.readFile", type: "query", input: { workspaceId: scope.workspaceId, absolutePath: `${scope.root}/${name}`, maxBytes: 1024 } })});return r.kind==='text'?r.content:atob(r.content);})()`,
		);
	const before = {
		first: await read("feature-native.txt"),
		second: await read("restore-ui.txt"),
	};
	assert.equal(
		(await evaluate("window.directWorkstation.getPreferences()")).values
			.fileAutoSave,
		"off",
	);
	await click("text:Files");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('[data-workspace-files] button')].some(b=>b.textContent.trim()==='feature-native.txt'&&!b.disabled)",
		),
	);
	await click("text:feature-native.txt");
	await until(() => evaluate(`Boolean(document.querySelector('${editor}'))`));
	const firstDraft = "first retained editor draft\nwith newline";
	await input(editor, firstDraft);
	const secondButton = await evaluate(
		"(()=>{const e=[...document.querySelectorAll('[data-workspace-files] button')].find(b=>b.textContent.trim()==='restore-ui.txt');return e?.outerHTML;})()",
	);
	assert.ok(secondButton);
	await show(
		`button[data-file-entry-path=${JSON.stringify(`${scope.root}/restore-ui.txt`)}]`,
	);
	await click("text:restore-ui.txt");
	await until(() =>
		evaluate(
			"document.querySelector('[role=tab][aria-label=\"restore-ui.txt\"]')?.getAttribute('aria-selected')==='true'",
		),
	);
	const secondDraft = "second retained editor draft";
	await input(editor, secondDraft);
	await click('[role=tab][aria-label="feature-native.txt"]');
	await until(text, (value) => value === firstDraft);
	await show(editor);
	await click(editor);
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "z",
		code: "KeyZ",
		windowsVirtualKeyCode: 90,
		modifiers: process.platform === "darwin" ? 4 : 2,
	});
	await until(text, (value) => value === before.first);
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: process.platform === "darwin" ? "Z" : "y",
		code: process.platform === "darwin" ? "KeyZ" : "KeyY",
		windowsVirtualKeyCode: process.platform === "darwin" ? 90 : 89,
		modifiers: process.platform === "darwin" ? 5 : 2,
	});
	await until(text, (value) => value === firstDraft);
	await click('[role=tab][aria-label="restore-ui.txt"]');
	await until(text, (value) => value === secondDraft);
	assert.equal(await read("feature-native.txt"), before.first);
	assert.equal(await read("restore-ui.txt"), before.second);
	await screenshot("multiple-files-retained-drafts");
	await click(
		'[role=tab][aria-label="feature-native.txt"] button[aria-label="Close tab"]',
	);
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=dialog]'))"),
	);
	await screenshot("multiple-files-close-confirmation");
	await click("text:Cancel");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await until(text, (value) => value === firstDraft);
	const save = "[role=tabpanel]:not([hidden]) button";
	await show(save);
	const savePoint = await evaluate(
		"(()=>{const e=[...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].find(b=>b.textContent.trim()==='Save file');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		clickCount: 1,
		...savePoint,
	});
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		clickCount: 1,
		...savePoint,
	});
	await until(
		() => read("feature-native.txt"),
		(value) => value === firstDraft,
	);
	assert.equal(await read("restore-ui.txt"), before.second);
	await click('[role=tab][aria-label="restore-ui.txt"]');
	const point = await evaluate(
		"(()=>{const r=document.querySelector('[role=tab][aria-label=\"restore-ui.txt\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
	);
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "right",
		clickCount: 1,
		...point,
	});
	await getPage().call("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "right",
		clickCount: 1,
		...point,
	});
	await until(() =>
		evaluate("Boolean(document.querySelector('[data-tab-action=close-all]'))"),
	);
	await click("[data-tab-action=close-all]");
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=dialog]'))"),
	);
	const description = await evaluate(
		"document.querySelector('[role=dialog]').innerText",
	);
	assert.ok(
		description.includes("feature-native.txt") &&
			description.includes("restore-ui.txt"),
	);
	await screenshot("multiple-files-close-all-confirmation");
	await click("text:Discard changes");
	await until(() =>
		evaluate("!document.querySelector('[data-workspace-files] [role=tab]')"),
	);
	assert.equal(await read("restore-ui.txt"), before.second);
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-multiple-files-ui.json"),
		`${JSON.stringify({ sourceRevision: process.env.GITHUB_SHA ?? null, sourceTest: process.argv.includes("--source-test"), physicalInput: true, workspaceId: scope.workspaceId, drafts: { first: firstDraft, second: secondDraft }, undoRedoRetainedAcrossTabs: true, noWriteBeforeSave: true, savedOnlySelectedFile: true, closeCancelledDraftRetained: true, closeAllDiscardedOnlyBuffers: true }, null, 2)}\n`,
	);
}
