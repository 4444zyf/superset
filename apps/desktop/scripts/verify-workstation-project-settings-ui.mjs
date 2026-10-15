import assert from "node:assert/strict";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationProjectSettingsUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		for (let i = 0; i < 150; i++) {
			const result = await read();
			if (result) return result;
			await delay(50);
		}
		await screenshot("project-settings-failure");
		throw new Error(
			`Project settings UI acceptance did not complete: ${JSON.stringify(await query())}; ${await evaluate("document.body.innerText.slice(-1800)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=v.targets.find(t=>t.connectionId===v.activeConnectionId);const workspaceId=target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId;const w=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:workspaceId,workspaceId}});return {descriptor:d,projectId:w.projectId,worktreePath:w.worktreePath};})()`,
	);
	assert.ok(scope.projectId);
	const query = () =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path: "project.get", type: "query", input: { projectId: scope.projectId } })})`,
		);
	const visible = async (selector) => {
		for (let i = 0; i < 8; i++) {
			const rect = await evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()`,
			);
			assert.ok(rect);
			if (rect.top >= 80 && rect.bottom < rect.height - 10) return;
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 850,
				y: 600,
				deltaX: 0,
				deltaY: rect.top < 80 ? -350 : 350,
			});
			await delay(50);
		}
		throw new Error("Project field is outside viewport");
	};
	const enabled = (selector) =>
		until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e && !e.disabled && !e.closest('fieldset')?.disabled;})()`,
			),
		);
	const replace = async (selector, value) => {
		await enabled(selector);
		await visible(selector);
		await click(selector);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		const started = await evaluate("performance.now()");
		await getPage().call("Input.insertText", { text: value });
		return started;
	};
	const blur = async () => {
		await visible("[data-project-settings] h2");
		await click("[data-project-settings] h2");
	};
	const open = async () => {
		await click(
			'[data-slot=sidebar-content] button[aria-label="Project Settings"]',
		);
		await enabled("#project-name");
	};
	const before = await query();
	await open();
	const size = await evaluate(
		"(()=>{const e=document.querySelector('[role=dialog]');return {width:e.clientWidth,scrollWidth:e.scrollWidth};})()",
	);
	assert.ok(size.scrollWidth <= size.width + 1);
	await screenshot("project-settings-original-layout");
	await replace("#project-name", "Unified Renamed");
	await blur();
	await until(async () => (await query()).name === "Unified Renamed");
	await enabled("#project-name");
	const pickerTrigger =
		'[data-project-settings] button[aria-label="Change project icon and color"]';
	await enabled(pickerTrigger);
	await click(pickerTrigger);
	const color =
		'[data-slot=popover-content] button[aria-label="Set color to Blue"]';
	const hit = async (selector) =>
		until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return !e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
			),
		);
	await hit(color);
	await screenshot("project-settings-original-icon-picker");
	await click(color);
	await until(async () => (await query()).color === "#3b82f6");
	const rocket = "[data-slot=popover-content] button[title=Rocket]";
	await hit(rocket);
	await click(rocket);
	const glyphIcon = await until(async () => {
		const icon = (await query()).icon;
		return icon?.startsWith("data:image/png;base64,") ? icon : null;
	});
	const pngSize = (icon) => {
		const bytes = Buffer.from(icon.split(",")[1], "base64");
		assert.ok(bytes.length < 256 * 1024);
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	};
	assert.deepEqual(pngSize(glyphIcon), { width: 128, height: 128 });
	const red =
		'[data-slot=popover-content] button[aria-label="Set color to Red"]';
	await hit(red);
	await click(red);
	const retintedIcon = await until(async () => {
		const actual = await query();
		return actual.color === "#ef4444" && actual.icon !== glyphIcon
			? actual.icon
			: null;
	});
	assert.deepEqual(pngSize(retintedIcon), { width: 128, height: 128 });
	await hit(color);
	await click(color);
	await until(async () => {
		const actual = await query();
		return actual.color === "#3b82f6" && actual.icon !== retintedIcon;
	});
	await enabled(rocket);
	await click("text:Remove icon");
	await until(async () => (await query()).icon === "none");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('[data-slot=popover-content] button')].some(e=>e.textContent.trim()==='Reset to default'&&!e.disabled)",
		),
	);
	await click("text:Reset to default");
	await until(async () => (await query()).icon === null);
	await enabled(rocket);
	const uploadSource = join(output, "project-icon-upload-source.png");
	copyFileSync(
		join(output, "project-settings-original-layout.png"),
		uploadSource,
	);
	await getPage().call("Page.setInterceptFileChooserDialog", { enabled: true });
	try {
		await click("text:Upload image…");
		const { root } = await getPage().call("DOM.getDocument");
		const { nodeId } = await getPage().call("DOM.querySelector", {
			nodeId: root.nodeId,
			selector: "[data-project-settings] input[type=file]",
		});
		assert.ok(nodeId);
		await getPage().call("DOM.setFileInputFiles", {
			nodeId,
			files: [uploadSource],
		});
	} finally {
		await getPage().call("Page.setInterceptFileChooserDialog", {
			enabled: false,
		});
	}
	const uploadedIcon = await until(async () => {
		const icon = (await query()).icon;
		return icon?.startsWith("data:image/png;base64,") && icon !== glyphIcon
			? icon
			: null;
	});
	assert.deepEqual(pngSize(uploadedIcon), { width: 128, height: 128 });
	assert.ok(readFileSync(uploadSource).readUInt32BE(16) > 128);
	await enabled(rocket);
	await screenshot("project-settings-uploaded-icon");
	await click("[data-project-settings] h2");
	await until(() =>
		evaluate("!document.querySelector('[data-slot=popover-content]')"),
	);
	await until(() =>
		evaluate(
			`document.querySelector('[data-slot=sidebar-content] img[alt="Unified Renamed icon"]')?.getAttribute('src')===${JSON.stringify(uploadedIcon)}`,
		),
	);
	const prefixMode = "[data-project-settings] button[role=combobox]";
	await enabled(prefixMode);
	await visible(prefixMode);
	await click(prefixMode);
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.trim()==='Custom prefix')",
		),
	);
	await screenshot("project-settings-original-prefix-menu");
	const point = await until(() =>
		evaluate(
			"(()=>{const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='Custom prefix');if(!e)return null;const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()",
		),
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "left",
			clickCount: type === "mouseMoved" ? 0 : 1,
			...point,
		});
	await until(async () => (await query()).branchPrefixMode === "custom");
	await until(() => evaluate("!document.querySelector('[role=listbox]')"));
	await replace("[data-project-settings] input[placeholder=Prefix]", "remix");
	await blur();
	await until(async () => (await query()).branchPrefixCustom === "remix");
	const namingStarted = await replace(
		"#project-naming-instructions",
		"Use feature/ for changes",
	);
	await until(
		async () =>
			(await query()).namingInstructions === "Use feature/ for changes",
	);
	const namingSaveMs = (await evaluate("performance.now()")) - namingStarted;
	assert.ok(namingSaveMs >= 400);
	assert.equal(
		await evaluate("document.activeElement?.id"),
		"project-naming-instructions",
	);
	await until(() =>
		evaluate(
			"document.querySelector('[data-project-text-field=naming] [role=status]')?.textContent.trim()==='Saved'",
		),
	);
	await screenshot("project-settings-naming-auto-saved-focused");
	const sparseStarted = await replace(
		"#project-sparse-checkout",
		"packages/ui\napps/desktop",
	);
	const saved = await until(async () => {
		const actual = await query();
		return actual.sparseCheckoutPaths.length === 2 ? actual : null;
	});
	assert.deepEqual(saved.sparseCheckoutPaths, ["packages/ui", "apps/desktop"]);
	const sparseSaveMs = (await evaluate("performance.now()")) - sparseStarted;
	assert.ok(sparseSaveMs >= 400);
	assert.equal(
		await evaluate("document.activeElement?.id"),
		"project-sparse-checkout",
	);
	await until(() =>
		evaluate(
			"document.querySelector('[data-project-text-field=sparse] [role=status]')?.textContent.trim()==='Saved'",
		),
	);
	await enabled("#project-name");
	await visible("#project-sparse-checkout");
	await screenshot("project-settings-sparse-checkout");
	const queryScripts = () =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path: "config.getProjectScriptsV1", type: "query", input: { projectId: scope.projectId } })})`,
		);
	assert.equal(
		scope.descriptor.capabilities?.workstationProjectScriptsV1,
		true,
	);
	const scriptTimings = {};
	const scriptValues = {
		Setup: "echo remix-setup\npwd",
		Teardown: "echo remix-teardown",
		Run: "echo remix-run",
	};
	for (const [field, text] of Object.entries(scriptValues)) {
		const tab = `[data-remote-project-scripts] [role=tab][data-state]`;
		await visible(tab);
		const point = await until(() =>
			evaluate(
				`(()=>{const e=[...document.querySelectorAll('[data-remote-project-scripts] [role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(field)});if(!e)return null;const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`,
			),
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: type === "mouseMoved" ? 0 : 1,
				...point,
			});
		const selector = `[data-remote-project-scripts] textarea[aria-label="${field}"]`;
		const started = await replace(selector, text);
		await until(
			async () =>
				JSON.stringify((await queryScripts()).scripts[field.toLowerCase()]) ===
				JSON.stringify(text.split("\n")),
		);
		scriptTimings[field] = (await evaluate("performance.now()")) - started;
		assert.ok(scriptTimings[field] >= 400);
		assert.equal(
			await evaluate("document.activeElement?.getAttribute('aria-label')"),
			field,
		);
		await until(() =>
			evaluate(
				"document.querySelector('[data-project-scripts] [role=status]')?.textContent.trim()==='Saved'",
			),
		);
	}
	await screenshot("project-scripts-original-tabs-auto-saved");
	const importFile = join(output, "project-run-import.sh");
	const importedCommands = ["echo remix-run-imported", "pwd"];
	writeFileSync(importFile, importedCommands.join("\n") + "\n");
	await getPage().call("Page.setInterceptFileChooserDialog", { enabled: true });
	try {
		await click(
			'[data-remote-project-scripts] button[title="Import from file"]',
		);
		const { root } = await getPage().call("DOM.getDocument");
		const { nodeId } = await getPage().call("DOM.querySelector", {
			nodeId: root.nodeId,
			selector: "[data-remote-project-scripts] input[type=file]",
		});
		assert.ok(nodeId);
		await getPage().call("DOM.setFileInputFiles", {
			nodeId,
			files: [importFile],
		});
	} finally {
		await getPage().call("Page.setInterceptFileChooserDialog", {
			enabled: false,
		});
	}
	const scriptsSaved = await until(async () => {
		const actual = await queryScripts();
		return JSON.stringify(actual.scripts.run) ===
			JSON.stringify(importedCommands)
			? actual
			: null;
	});
	await until(() =>
		evaluate(
			"document.querySelector('[data-project-scripts] [role=status]')?.textContent.trim()==='Saved'",
		),
	);
	await screenshot("project-scripts-imported-run");
	await click("[role=dialog] button[aria-label=Close]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await open();
	assert.equal(
		await evaluate("document.querySelector('#project-name').value"),
		"Unified Renamed",
	);
	assert.equal(
		await evaluate(
			"document.querySelector('#project-naming-instructions').value",
		),
		"Use feature/ for changes",
	);
	assert.equal(
		await evaluate("document.querySelector('#project-sparse-checkout').value"),
		"packages/ui\napps/desktop",
	);
	assert.equal((await query()).icon, uploadedIcon);
	await until(() =>
		evaluate(
			`document.querySelector('[data-project-settings] img[alt="Unified Renamed icon"]')?.naturalWidth === 128`,
		),
	);
	await screenshot("project-settings-reopened");
	await visible("[data-remote-project-scripts] textarea[aria-label=Setup]");
	assert.equal(
		await evaluate(
			`document.querySelector('[data-remote-project-scripts] textarea[aria-label=Setup]').value`,
		),
		scriptValues.Setup,
	);
	assert.deepEqual((await queryScripts()).scripts, scriptsSaved.scripts);
	await screenshot("project-scripts-reopened-setup");
	await click("[role=dialog] button[aria-label=Close]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	writeFileSync(
		join(output, "workstation-project-settings-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalLayout: true,
				originalColorSelector: true,
				originalIconPicker: true,
				glyph: pngSize(glyphIcon),
				glyphRecolored: true,
				removeAndReset: true,
				imageUpload: { browserFileChooser: true, size: pngSize(uploadedIcon) },
				sidebarIconMatches: true,
				projectScripts: {
					originalTabs: true,
					autoSaveWhileFocused: true,
					browserFileImport: true,
					scriptTimings,
					saved: scriptsSaved.scripts,
					reopened: true,
					executed: false,
				},
				blurSave: true,
				textAutoSaveWhileFocused: true,
				originalDefaultDebounceMs: 500,
				savedIndicators: true,
				namingSaveMs,
				sparseSaveMs,
				reopened: true,
				before,
				saved,
				worktreePathBeforeRename: scope.worktreePath,
				size,
			},
			null,
			2,
		) + "\n",
	);
}
