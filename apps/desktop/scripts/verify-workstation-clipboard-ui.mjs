import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationClipboardUi({
	getPage,
	click,
	screenshot,
	setClipboard,
	pasteClipboard,
	inspectClipboardImage,
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
		throw new Error("Clipboard acceptance did not become ready");
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const w=v.targets.find(t=>t.connectionId===d.connectionId).workspaces.find(w=>w.tabId===v.targets.find(t=>t.connectionId===d.connectionId).activeTabId);const row=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {d,w,root:row.worktreePath};})()`,
	);
	const query = (path, input) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.d.connectionId, generation: scope.d.generation, path, type: "query", input: { workspaceId: scope.w.workspaceId, ...input } })})`,
		);
	const key = async (name, code, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key: name,
				code: name === "Enter" ? "Enter" : `Key${name.toUpperCase()}`,
				windowsVirtualKeyCode: code,
				modifiers,
			});
	};
	const text = async (value) =>
		getPage().call("Input.insertText", { text: value });
	const enter = () => key("Enter", 13);
	const paste = () =>
		pasteClipboard
			? pasteClipboard()
			: key("v", 86, process.platform === "darwin" ? 4 : 2);
	const rows = () =>
		evaluate(
			`[...document.querySelectorAll('[data-terminal-id]')].map(e=>({terminalId:e.dataset.terminalId,executionId:e.dataset.executionId,state:e.dataset.restoreState,paneId:e.closest('[data-pane-id]')?.dataset.paneId}))`,
		);
	await click("text:New terminal");
	const terminal = await until(async () => {
		const row = (await rows()).find(
			(r) => !scope.w.panes.some((p) => p.resourceId === r.terminalId),
		);
		return row?.state === "attached" ? row : null;
	});
	const point = await until(() =>
		evaluate(
			`(()=>{const e=document.querySelector('[data-terminal-id="${terminal.terminalId}"] .xterm-screen');if(!e)return null;const r=e.getBoundingClientRect();let left=Math.max(r.left,0),right=Math.min(r.right,innerWidth),top=Math.max(r.top,0),bottom=Math.min(r.bottom,innerHeight);for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|scroll|auto/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}if(right<=left||bottom<=top)return null;const x=(left+right)/2,y=(top+bottom)/2;return e.contains(document.elementFromPoint(x,y))?{x,y,visibleWidth:right-left,visibleHeight:bottom-top}:null;})()`,
		),
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "left",
			clickCount: type === "mouseMoved" ? 0 : 1,
			x: point.x,
			y: point.y,
		});
	await until(() =>
		evaluate(
			`document.activeElement?.closest('[data-terminal-id]')?.dataset.terminalId===${JSON.stringify(terminal.terminalId)}`,
		),
	);
	writeFileSync(
		join(output, "clipboard-input-target.json"),
		JSON.stringify(point, null, 2) + "\n",
	);
	await screenshot("clipboard-image-source");
	const expected = await setClipboard({
		imageBase64: readFileSync(
			join(output, "clipboard-image-source.png"),
		).toString("base64"),
	});
	writeFileSync(
		join(output, "clipboard-native-source.json"),
		JSON.stringify(expected, null, 2) + "\n",
	);
	await evaluate(
		`(()=>{window.clipboardProbe=[];document.addEventListener('paste',e=>{window.clipboardProbe.push({types:[...e.clipboardData.types],files:[...e.clipboardData.files].map(f=>({name:f.name,type:f.type,size:f.size})),textLength:e.clipboardData.getData('text/plain').length});},{capture:true});return true;})()`,
	);
	await text("wc -c < ");
	await paste();
	await until(() => evaluate("window.clipboardProbe.length>0"));
	writeFileSync(
		join(output, "clipboard-observed-paste.json"),
		JSON.stringify(await evaluate("window.clipboardProbe"), null, 2) + "\n",
	);
	const directory = `${scope.root}/.superset/attachments`;
	const image = await until(async () => {
		try {
			const result = await query("filesystem.listDirectory", {
				absolutePath: directory,
			});
			return result.entries.find((e) => e.name.endsWith(".png"));
		} catch {
			return null;
		}
	});
	await until(() =>
		evaluate(
			`!document.querySelector('[data-terminal-id="${terminal.terminalId}"]').parentElement.querySelector('output')`,
		),
	);
	const imageFile = await query("filesystem.readFile", {
		absolutePath: `${directory}/${image.name}`,
		maxBytes: 1024 * 1024,
	});
	assert.equal(imageFile.kind, "bytes");
	const decoded = await inspectClipboardImage(imageFile.content);
	assert.deepEqual(decoded, expected.image);
	await screenshot("clipboard-remote-image-path-before-enter");
	await enter();
	const observed = await until(async () => {
		const row = await controls.inspectRunExecution(terminal);
		const lines = stripVTControlCharacters(row.output)
			.replace(/\r/g, "")
			.split("\n");
		return lines.some(
			(line) =>
				line.trim() ===
				String(Buffer.from(imageFile.content, "base64").byteLength),
		)
			? row
			: null;
	});
	await screenshot("clipboard-remote-shell-read-image");
	await setClipboard({
		imageBase64: readFileSync(
			join(output, "clipboard-image-source.png"),
		).toString("base64"),
	});
	await paste();
	const second = await until(async () => {
		const result = await query("filesystem.listDirectory", {
			absolutePath: directory,
		});
		return result.entries.filter((e) => e.name.endsWith(".png")).length === 2;
	});
	assert.equal(second, true);
	await until(() =>
		evaluate(
			`!document.querySelector('[data-terminal-id="${terminal.terminalId}"]').parentElement.querySelector('output')`,
		),
	);
	await key("u", 85, 2);
	const plain = "中文消息 🙂\n" + "multiline clipboard 你好\n".repeat(128);
	await text(`cat > .superset/attachments/clipboard-text.txt`);
	await enter();
	await setClipboard({ text: plain });
	await paste();
	await key("d", 68, 2);
	await until(async () => {
		try {
			const read = await query("filesystem.readFile", {
				absolutePath: `${directory}/clipboard-text.txt`,
				maxBytes: 32 * 1024,
			});
			return read.content === plain;
		} catch {
			return null;
		}
	});
	await screenshot("clipboard-remote-multiline-text");
	await click(
		`[data-pane-id="${terminal.paneId}"] button[aria-label="Close pane"]`,
	);
	await until(async () => (await rows()).length === scope.w.panes.length);
	if (scope.w.activePaneId)
		await click(`[data-pane-id="${scope.w.activePaneId}"] .xterm-screen`);
	writeFileSync(
		join(output, "workstation-clipboard-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalNativePaste: true,
				osClipboard: true,
				terminal: terminal.terminalId,
				executionId: terminal.executionId,
				remoteDirectory: directory,
				imagePixels: decoded,
				imageEncodedSha256: createHash("sha256")
					.update(Buffer.from(imageFile.content, "base64"))
					.digest("hex"),
				remoteShellRead: true,
				remotePid: observed.pid,
				duplicatePasteDidNotOverwrite: true,
				textBytes: Buffer.byteLength(plain),
				textSha256: createHash("sha256").update(plain).digest("hex"),
				textExact: true,
				vendorAgentVerified: false,
				chatNativePasteVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
