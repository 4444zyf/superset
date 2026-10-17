import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot:v}=await window.directWorkstation.getWorkspaceView();const t=v.targets.find(t=>t.connectionId===d.connectionId);return {connectionId:d.connectionId,workspaceId:t.workspaces.find(w=>w.tabId===t.activeTabId).workspaceId,chatHarnesses:d.chatHarnesses,chatAttachmentInput:d.capabilities?.workstationChatAttachmentInputV1};})()`,
	);
	const query = (path, input = {}) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)})throw new Error('Unexpected SSH owner');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const sessions = () =>
		query("chat.listSessions", { workspaceId: scope.workspaceId });
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const originalTerminals = await controls.verifyWorktreeLocation(
		workspace.worktreePath,
	);
	const selectedSession = () =>
		evaluate(
			`(async()=>{const {snapshot}=await window.directWorkstation.getWorkspaceView();const target=snapshot.targets.find(t=>t.connectionId===${JSON.stringify(scope.connectionId)});const workspace=target.workspaces.find(w=>w.workspaceId===${JSON.stringify(scope.workspaceId)});return workspace.panes.find(p=>p.paneId===workspace.activePaneId)?.resourceId;})()`,
		);
	const expectedPrompts = new Map();
	const noPrompt = async () => {
		for (const session of await sessions()) {
			const page = await query("chat.getItems", {
				sessionId: session.sessionId,
			});
			assert.equal(page.ok, true);
			assert.equal(page.nextBefore, null);
			const messages = new Map(
				page.envelopes
					.filter(
						(e) =>
							e.event.type === "item" && e.event.item.kind === "user_message",
					)
					.map((e) => [e.event.item.id, e.event.item.content]),
			);
			assert.deepEqual(
				[...messages.values()],
				expectedPrompts.get(session.sessionId) ?? [],
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
			`(()=>{const section=document.querySelector('${area}')?.closest('section');const attach=[...(section?.querySelectorAll('button')??[])].find(e=>e.textContent.trim()==='Attach files'&&!e.closest('article'));return [...(attach?.parentElement?.querySelectorAll('button')??[])].filter(e=>(e.getAttribute('aria-label')??e.textContent.trim())===${JSON.stringify(name)}).length;})()`,
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
	assert.equal(scope.chatAttachmentInput, true);
	assert.equal((await sessions()).length, 0);
	assert.equal(
		scope.chatHarnesses.some((h) => h.id === "codex" && h.available),
		true,
	);
	await click("text:Chat");
	await click("text:New chat");
	await ready();
	const first = await until(async () => (await sessions())[0]);
	let startupRejection = null;
	if (process.argv.includes("--expect-codex-version-rejection")) {
		startupRejection = await until(() =>
			evaluate(
				`(()=>{const text=document.querySelector('${area}')?.closest('section')?.querySelector('article')?.textContent;return text?.includes('codex 0.160.0 or newer is needed for chat')&&!text.includes('too_small')?text:null;})()`,
			),
		);
	}
	if (process.argv.includes("--expect-rejected-chat-send")) {
		await click("text:New chat");
		await until(async () => (await sessions()).length === 2);
		await ready();
		assert.equal(await message(), "");
		await noPrompt();
		await click("text:codex #1");
		await ready();
	}
	await until(() =>
		evaluate(
			"document.querySelectorAll('.ws-compact-panes button').length===4",
		),
	);
	await screenshot("chat-clipboard-before-paste");
	writeFileSync(
		join(output, "chat-clipboard-input-geometry.json"),
		JSON.stringify(
			await evaluate(
				`(()=>{const e=document.querySelector('${area}'),r=e.getBoundingClientRect(),parents=[];for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();parents.push({tag:p.tagName,className:p.className,x:b.x,y:b.y,width:b.width,height:b.height,display:s.display,minWidth:s.minWidth,maxWidth:s.maxWidth,flex:s.flex,flexWrap:s.flexWrap,alignItems:s.alignItems,overflowX:s.overflowX,overflowY:s.overflowY});}return {x:r.x,y:r.y,width:r.width,height:r.height,viewportHeight:innerHeight,viewportWidth:innerWidth,parents};})()`,
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
	let rejectedSend = false;
	let sentSessionId = null;
	if (process.argv.includes("--expect-rejected-chat-send")) {
		assert.ok(
			startupRejection?.includes("codex 0.160.0 or newer is needed for chat"),
		);
		const second = images.find((a) => a.attachmentId !== image.attachmentId);
		sentSessionId = await selectedSession();
		assert.ok(
			(await sessions()).some((session) => session.sessionId === sentSessionId),
		);
		expectedPrompts.set(sentSessionId, [
			[
				{ type: "text", text: plain },
				...[image, second, ...(file ? [file] : [])].map((a) => ({
					type: "attachment",
					attachmentId: a.attachmentId,
					name: a.originalFilename,
					mimeType: a.mediaType,
				})),
			],
		]);
		await click("text:Send");
		await until(() =>
			evaluate(
				`document.querySelector('${area}')?.closest('section')?.querySelector('[role=alert]')?.textContent.trim()`,
			),
		);
		await ready();
		await screenshot("chat-clipboard-after-send-before-assertions");
		assert.equal(controls.inspectChatAttachments().length, file ? 3 : 2);
		assert.equal(await message(), plain);
		assert.equal(await attachedCount("image.png"), 2);
		if (file) assert.equal(await attachedCount(file.originalFilename), 1);
		await noPrompt();
		await screenshot("chat-clipboard-rejected-send-keeps-draft");
		rejectedSend = true;
	}
	const draftedSessionId = await selectedSession();
	let unresolvedPrompt = null;
	if (rejectedSend) {
		await click("text:New chat");
		await until(() =>
			evaluate(
				`document.querySelector('${area}')?.closest('section')?.querySelector('[role=alert]')?.textContent.includes('Reconcile the pending operation')`,
			),
		);
		await ready();
		assert.equal(await message(), plain);
		assert.equal(await attachedCount("image.png"), 2);
		if (file) assert.equal(await attachedCount(file.originalFilename), 1);
		const pending = await evaluate(
			`window.directWorkstation.inspectPending(${JSON.stringify(scope.connectionId)})`,
		);
		assert.equal(pending.length, 1);
		assert.equal(pending[0].procedure, "chat.prompt");
		assert.equal(pending[0].status, "unresolved");
		unresolvedPrompt = pending[0];
		await screenshot("chat-clipboard-blocked-new-chat-keeps-draft");
		await click("text:codex #1");
		if ((await selectedSession()) === sentSessionId)
			await click("text:codex #2");
		await until(async () => (await selectedSession()) !== sentSessionId);
	} else {
		await click("text:New chat");
		await until(async () => (await sessions()).length === 2);
	}
	await ready();
	assert.equal(await message(), "");
	assert.equal(await attachedCount("image.png"), 0);
	await noPrompt();
	await screenshot("chat-clipboard-new-session-isolated");

	const draftActions = process.argv.includes("--expect-chat-draft-actions");
	const retainDrafts =
		process.argv.includes("--expect-retained-chat-drafts") || draftActions;
	const selectDraftedChat = async () => {
		const rows = await sessions();
		const index = rows.findIndex((row) => row.sessionId === draftedSessionId);
		assert.ok(index >= 0);
		await click(`text:codex #${index + 1}`);
		await until(async () => (await selectedSession()) === draftedSessionId);
		await ready();
	};
	if (retainDrafts) {
		await selectDraftedChat();
		await until(async () => (await message()) === plain);
		assert.equal(await attachedCount("image.png"), 2);
		if (file) assert.equal(await attachedCount(file.originalFilename), 1);
		await screenshot("chat-draft-returned-session-text-and-attachments");
		await click("text:Files");
		await until(() => evaluate(`!document.querySelector('${area}')`));
		await click("text:Terminal");
		await ready();
		assert.equal(await message(), plain);
		assert.equal(await attachedCount("image.png"), 2);
		if (file) assert.equal(await attachedCount(file.originalFilename), 1);
		await noPrompt();
		await screenshot("chat-draft-returned-from-files-without-send");
	}
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await ready();
	assert.equal((await sessions()).length, 2);
	await until(async () => (await message()) === (retainDrafts ? plain : ""));
	assert.equal(await attachedCount("image.png"), retainDrafts ? 2 : 0);
	if (retainDrafts && file)
		assert.equal(await attachedCount(file.originalFilename), 1);
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
	let persistedDraft = null;
	if (retainDrafts) {
		const snapshot = await evaluate("window.directWorkstation.getChatDrafts()");
		assert.equal(snapshot.invalid, false);
		const entry = snapshot.entries.find(
			(entry) =>
				entry.identity.sessionId === draftedSessionId &&
				entry.identity.workspaceId === scope.workspaceId,
		);
		assert.ok(entry);
		assert.equal(entry.value.text, plain);
		assert.deepEqual(
			entry.value.attachments.map((a) => a.attachmentId).sort(),
			controls
				.inspectChatAttachments()
				.map((a) => a.attachmentId)
				.sort(),
		);
		persistedDraft = {
			revision: snapshot.revision,
			entries: snapshot.entries.length,
			attachmentIds: entry.value.attachments.map((a) => a.attachmentId),
			textSha256: createHash("sha256").update(entry.value.text).digest("hex"),
		};
		assert.equal(controls.inspectChatAttachments().length, file ? 3 : 2);
		await screenshot("chat-draft-reopened-persisted-without-upload-or-send");
	}

	let draftActionsChecked = false;
	if (draftActions) {
		assert.ok(persistedDraft);
		const snapshot = await evaluate("window.directWorkstation.getChatDrafts()");
		const originalDraft = snapshot.entries.find(
			(entry) => entry.identity.sessionId === draftedSessionId,
		);
		const removed = originalDraft.value.attachments[0];
		await click('[aria-label="Remove attachment"]');
		await until(async () => {
			const current = await evaluate(
				"window.directWorkstation.getChatDrafts()",
			);
			return (
				current.entries.find(
					(entry) => entry.identity.sessionId === draftedSessionId,
				)?.value.attachments.length === (file ? 2 : 1)
			);
		});
		assert.equal(await message(), plain);
		assert.equal(controls.inspectChatAttachments().length, file ? 3 : 2);
		const removedFile = await readAttachment(removed.attachmentId);
		assert.equal(
			createHash("sha256")
				.update(Buffer.from(Object.values(removedFile.bytes)))
				.digest("hex"),
			controls
				.inspectChatAttachments()
				.find((a) => a.attachmentId === removed.attachmentId).sha256,
		);
		await noPrompt();
		await screenshot("chat-draft-original-tile-reference-removed");
		await click(
			".ws-workspace-window .ws-window-toolbar:first-child button:first-child",
		);
		await until(() =>
			evaluate("Boolean(document.querySelector('.ws-workspace-grid'))"),
		);
		await click(`[data-workspace-delete=${JSON.stringify(scope.workspaceId)}]`);
		await until(() =>
			evaluate("Boolean(document.querySelector('[role=alertdialog]'))"),
		);
		const inspection = await query("workspaceCleanup.inspect", {
			workspaceId: scope.workspaceId,
		});
		assert.equal(inspection.canDelete, true);
		await click(
			inspection.hasChanges || inspection.hasUnpushedCommits
				? "text:Delete anyway"
				: "text:Delete",
		);
		await until(() =>
			evaluate(
				"document.querySelector('[role=alertdialog]')?.textContent.includes('Unsaved changes')",
			),
		);
		assert.equal(existsSync(workspace.worktreePath), true);
		await screenshot("chat-draft-protects-workspace-deletion");
		await click("text:Cancel");
		await click(
			`button.ws-workspace-card[aria-label=${JSON.stringify(workspace.name)}]`,
		);
		await ready();
		await selectDraftedChat();
		assert.equal(await message(), plain);
		await click("text:Discard changes");
		await until(() =>
			evaluate("Boolean(document.querySelector('[role=alertdialog]'))"),
		);
		await screenshot("chat-draft-original-discard-confirmation");
		await click("text:Cancel");
		await until(() =>
			evaluate("!document.querySelector('[role=alertdialog]')"),
		);
		assert.equal(await message(), plain);
		await click("text:Discard changes");
		await until(() =>
			evaluate("Boolean(document.querySelector('[role=alertdialog]'))"),
		);
		await click('[role="alertdialog"] button:last-child');
		await until(
			async () =>
				(await message()) === "" &&
				(await evaluate("!document.querySelector('[role=alertdialog]')")),
		);
		assert.equal(await message(), "");
		assert.equal(
			await evaluate(
				"document.querySelectorAll('[aria-label=\"Remove attachment\"]').length",
			),
			0,
		);
		const cleared = await evaluate("window.directWorkstation.getChatDrafts()");
		assert.equal(
			cleared.entries.some(
				(entry) => entry.identity.sessionId === draftedSessionId,
			),
			false,
		);
		assert.equal(controls.inspectChatAttachments().length, file ? 3 : 2);
		await noPrompt();
		await screenshot("chat-draft-explicitly-discarded-without-send");
		await closeReopen();
		await until(() =>
			evaluate(
				`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
			),
		);
		await ready();
		assert.equal(await message(), "");
		assert.equal(controls.inspectChatAttachments().length, file ? 3 : 2);
		assert.equal(
			(await evaluate("window.directWorkstation.getChatDrafts()")).entries.some(
				(entry) => entry.identity.sessionId === draftedSessionId,
			),
			false,
		);
		await noPrompt();
		await screenshot("chat-draft-discarded-and-reopened-without-replay");
		draftActionsChecked = true;
	}
	const restoredTerminals = await controls.verifyWorktreeLocation(
		workspace.worktreePath,
	);
	assert.deepEqual(restoredTerminals, originalTerminals);
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-chat-clipboard-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				retainedDraftsChecked: retainDrafts,
				draftActionsChecked,
				persistedDraft,
				physicalNativePaste: true,
				osClipboard: true,
				workspaceId: scope.workspaceId,
				adaptiveCompactSwitcher: true,
				chatAttachmentInputCapability: scope.chatAttachmentInput,
				explicitRejectedSendChecked: rejectedSend,
				unresolvedPrompt,
				blockedNewChatKeepsDraft: rejectedSend,
				originalTerminalsRetained: restoredTerminals.terminals,
				firstSessionId: first.sessionId,
				sentSessionId,
				startupRejection,
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
