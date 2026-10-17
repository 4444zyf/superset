import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function verifyWorkstationChatClipboardUi({
	getPage,
	click,
	screenshot,
	closeReopen,
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
		await screenshot("chat-clipboard-failure");
		throw new Error(
			`Chat clipboard not ready: ${await evaluate("document.body.innerText.slice(-1600)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot:v}=await window.directWorkstation.getWorkspaceView();const t=v.targets.find(t=>t.connectionId===d.connectionId);return {connectionId:d.connectionId,workspaceId:t.workspaces.find(w=>w.tabId===t.activeTabId).workspaceId,chatHarnesses:d.chatHarnesses};})()`,
	);
	const query = (path, input = {}) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)})throw new Error('Unexpected SSH owner');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const sessions = () =>
		query("chat.listSessions", { workspaceId: scope.workspaceId });
	const noPrompt = async () => {
		for (const session of await sessions()) {
			const page = await query("chat.getItems", {
				sessionId: session.sessionId,
			});
			assert.equal(page.ok, true);
			assert.equal(page.nextBefore, null);
			assert.equal(
				page.envelopes.some(
					(e) =>
						e.event.type === "item" && e.event.item.kind === "user_message",
				),
				false,
			);
			assert.equal(
				page.envelopes.some((e) => e.event.type === "turn"),
				false,
			);
		}
	};
	const area = 'textarea[aria-label="Message"]';
	const message = () => evaluate(`document.querySelector('${area}')?.value`);
	const attachedCount = (name) =>
		evaluate(
			`(()=>{const section=document.querySelector('${area}')?.closest('section');return [...(section?.querySelectorAll('button')??[])].filter(e=>e.textContent.trim()===${JSON.stringify(name)}).length;})()`,
		);
	const paste = async () => {
		const geometry = await evaluate(
			`(()=>{const e=document.querySelector('${area}'),r=e.getBoundingClientRect();let left=Math.max(r.left,0),right=Math.min(r.right,innerWidth),top=Math.max(r.top,0),bottom=Math.min(r.bottom,innerHeight);for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|scroll|auto/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|scroll|auto/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}const x=r.x+r.width/2,y=r.y+r.height/2;return {width:r.width,height:r.height,visibleWidth:Math.max(0,right-left),visibleHeight:Math.max(0,bottom-top),hit:e===document.elementFromPoint(x,y)};})()`,
		);
		assert.ok(
			geometry.hit &&
				geometry.visibleWidth >= geometry.width - 1 &&
				geometry.visibleHeight >= geometry.height - 1,
			JSON.stringify(geometry),
		);
		await click(area);
		if (pasteClipboard) await pasteClipboard();
		else
			for (const type of ["keyDown", "keyUp"])
				await getPage().call("Input.dispatchKeyEvent", {
					type,
					key: "v",
					code: "KeyV",
					windowsVirtualKeyCode: 86,
					modifiers: process.platform === "darwin" ? 4 : 2,
				});
	};
	const ready = () =>
		until(() =>
			evaluate(
				`Boolean(document.querySelector('${area}') && !document.querySelector('${area}').readOnly)`,
			),
		);
	assert.equal(controls.inspectChatAttachments().length, 0);
	assert.equal((await sessions()).length, 0);
	assert.equal(
		scope.chatHarnesses.some((h) => h.id === "codex" && h.available),
		true,
	);
	await click("text:Chat");
	await click("text:New chat");
	await ready();
	const first = await until(async () => (await sessions())[0]);
	await screenshot("chat-clipboard-before-paste");
	writeFileSync(
		join(output, "chat-clipboard-input-geometry.json"),
		JSON.stringify(
			await evaluate(
				`(()=>{const e=document.querySelector('${area}'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportHeight:innerHeight,viewportWidth:innerWidth};})()`,
			),
			null,
			2,
		) + "\n",
	);
	await evaluate(
		`(()=>{window.chatPasteEvents=[];document.addEventListener('paste',e=>{if(e.target.matches?.('${area}'))window.chatPasteEvents.push({trusted:e.isTrusted,types:[...e.clipboardData.types],files:[...e.clipboardData.files].map(f=>({name:f.name,size:f.size,type:f.type})),textLength:e.clipboardData.getData('text/plain').length});},true);return true;})()`,
	);
	const plain = "中文消息 🙂\n" + "multiline clipboard 你好\n".repeat(128);
	await setClipboard({ text: plain });
	await paste();
	await until(async () => (await message()) === plain);
	await screenshot("chat-clipboard-text-unsent");
	await noPrompt();
	const sourcePath = join(output, "chat-clipboard-text-unsent.png");
	const imageClipboard = await setClipboard({
		imageBase64: readFileSync(sourcePath).toString("base64"),
	});
	await paste();
	await until(
		async () =>
			controls.inspectChatAttachments().length === 1 &&
			(await attachedCount("image.png")) === 1,
	);
	await ready();
	const image = controls.inspectChatAttachments()[0];
	assert.equal(image.mediaType, "image/png");
	const readAttachment = (id) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)})throw new Error('Unexpected SSH owner');return window.directWorkstation.readAttachment(d,${JSON.stringify(id)});})()`,
		);
	const downloadedImage = await readAttachment(image.attachmentId);
	const bytes = Buffer.from(Object.values(downloadedImage.bytes));
	assert.equal(createHash("sha256").update(bytes).digest("hex"), image.sha256);
	assert.deepEqual(
		await inspectClipboardImage(bytes.toString("base64")),
		imageClipboard.image,
	);
	assert.equal(await message(), plain);
	await noPrompt();
	await paste();
	await until(
		async () =>
			controls.inspectChatAttachments().length === 2 &&
			(await attachedCount("image.png")) === 2,
	);
	await ready();
	const images = controls.inspectChatAttachments();
	assert.notEqual(images[0].attachmentId, images[1].attachmentId);
	assert.equal(images[0].sha256, images[1].sha256);
	let file = null;
	if (process.platform === "linux") {
		const fileText = "copied chat file 中文 🙂\nSecond line\n";
		const fileName = "chat selected '中文'.txt";
		const filePath = join(output, fileName);
		writeFileSync(filePath, fileText, { flag: "wx" });
		await setClipboard({ fileUri: pathToFileURL(filePath).href });
		await paste();
		await until(
			async () =>
				controls.inspectChatAttachments().length === 3 &&
				(await attachedCount(fileName)) === 1,
		);
		await ready();
		file = controls
			.inspectChatAttachments()
			.find((a) => a.originalFilename === fileName);
		assert.ok(file);
		assert.equal(
			file.sha256,
			createHash("sha256").update(fileText).digest("hex"),
		);
		const downloaded = await readAttachment(file.attachmentId);
		assert.equal(
			Buffer.from(Object.values(downloaded.bytes)).toString("utf8"),
			fileText,
		);
	}
	assert.equal(await message(), plain);
	await noPrompt();
	await screenshot("chat-clipboard-attachments-unsent");
	const observedPastes = await evaluate("window.chatPasteEvents");
	assert.ok(
		observedPastes.length >= 3 && observedPastes.every((e) => e.trusted),
	);
	await click("text:New chat");
	await until(async () => (await sessions()).length === 2);
	await ready();
	assert.equal(await message(), "");
	assert.equal(await attachedCount("image.png"), 0);
	await noPrompt();
	await screenshot("chat-clipboard-new-session-isolated");
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await ready();
	assert.equal((await sessions()).length, 2);
	assert.equal(await message(), "");
	assert.equal(await attachedCount("image.png"), 0);
	assert.equal(controls.inspectChatAttachments().length, file ? 3 : 2);
	const reopenedImage = await readAttachment(image.attachmentId);
	assert.equal(
		createHash("sha256")
			.update(Buffer.from(Object.values(reopenedImage.bytes)))
			.digest("hex"),
		image.sha256,
	);
	await noPrompt();
	await screenshot("chat-clipboard-reopened-without-send");
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-chat-clipboard-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalNativePaste: true,
				osClipboard: true,
				workspaceId: scope.workspaceId,
				firstSessionId: first.sessionId,
				textBytes: Buffer.byteLength(plain),
				textSha256: createHash("sha256").update(plain).digest("hex"),
				textExact: true,
				imagePixels: imageClipboard.image,
				images,
				file,
				observedPastes,
				remoteStoredBytesChecked: true,
				remoteAttachmentReadbackChecked: true,
				duplicatePasteDidNotOverwrite: true,
				noAutomaticPrompt: true,
				newSessionIsolated: true,
				reopenRetainedAttachmentsWithoutSend: true,
				vendorAuthenticationChecked: false,
				vendorAgentVerified: false,
				explicitSendVerified: false,
				actualFileManagerCopy: false,
				macOSVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
