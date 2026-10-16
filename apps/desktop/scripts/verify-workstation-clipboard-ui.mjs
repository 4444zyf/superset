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
		writeFileSync(
			join(output, "clipboard-failure-diagnostic.json"),
			JSON.stringify(
				await evaluate(
					`({keys:window.clipboardKeyProbe,pastes:window.clipboardProbe,activeTerminal:document.activeElement?.closest('[data-terminal-id]')?.dataset.terminalId,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.slice(0,2000))})`,
				),
				null,
				2,
			) + "\n",
		);
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
		`(()=>{window.clipboardKeyProbe=[];document.addEventListener("keydown",e=>{if(window.clipboardKeyProbe.length<32)window.clipboardKeyProbe.push({code:e.code,key:e.key,ctrl:e.ctrlKey,shift:e.shiftKey,meta:e.metaKey,terminal:e.target.closest?.("[data-terminal-id]")?.dataset.terminalId});},true);window.clipboardProbe=[];document.addEventListener('paste',e=>{window.clipboardProbe.push({types:[...e.clipboardData.types],files:[...e.clipboardData.files].map(f=>({name:f.name,type:f.type,size:f.size})),textLength:e.clipboardData.getData('text/plain').length});},{capture:true});return true;})()`,
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
	writeFileSync(
		join(output, "clipboard-image-checkpoint.json"),
		JSON.stringify(
			{
				imagePixels: decoded,
				expected: expected.image,
				encodedBytes: Buffer.from(imageFile.content, "base64").byteLength,
				remoteShellRead: true,
				duplicatePasteDidNotOverwrite: true,
			},
			null,
			2,
		) + "\n",
	);
	await until(() =>
		evaluate(
			`!document.querySelector('[data-terminal-id="${terminal.terminalId}"]').parentElement.querySelector('output')`,
		),
	);
	await key("u", 85, 2);
	const plain = "中文消息 🙂\n" + "multiline clipboard 你好\n".repeat(128);
	await text(`cat > .superset/attachments/clipboard-text.txt`);
	await enter();
	await until(async () => {
		try {
			return (
				(
					await query("filesystem.getMetadata", {
						absolutePath: `${directory}/clipboard-text.txt`,
					})
				)?.kind === "file"
			);
		} catch {
			return false;
		}
	});
	await setClipboard({ text: plain });
	await paste();
	let lastText = null;
	try {
		await until(async () => {
			try {
				const read = await query("filesystem.readFile", {
					absolutePath: `${directory}/clipboard-text.txt`,
					maxBytes: 32 * 1024,
				});
				lastText = read;
				return (
					!read.exceededLimit &&
					read.byteLength === Buffer.byteLength(plain) &&
					Buffer.from(
						read.content,
						read.kind === "text" ? "utf8" : "base64",
					).equals(Buffer.from(plain))
				);
			} catch {
				return null;
			}
		});
	} finally {
		writeFileSync(
			join(output, "clipboard-text-diagnostic.json"),
			JSON.stringify(
				{
					expected: plain,
					actual: lastText,
					terminal: await controls.inspectRunExecution(terminal),
				},
				null,
				2,
			) + "\n",
		);
	}
	await key("d", 68, 2);
	await screenshot("clipboard-remote-multiline-text");
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "right",
			clickCount: type === "mouseMoved" ? 0 : 1,
			x: point.x,
			y: point.y,
		});
	const closePoint = await until(() =>
		evaluate(
			`(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='Close pane');if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
		),
	);
	await screenshot("clipboard-original-close-menu");
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "left",
			clickCount: type === "mouseMoved" ? 0 : 1,
			...closePoint,
		});
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
