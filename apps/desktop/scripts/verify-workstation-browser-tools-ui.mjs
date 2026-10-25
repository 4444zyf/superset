import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationBrowserToolsUi(options, context) {
	const {
		getPage,
		click,
		screenshot,
		output,
		readClipboardText,
		inspectBrowserTools,
		captureBrowserDevTools,
		inspectBrowserDevTools,
		closeBrowserDevTools,
	} = options;
	const { url, marker, readProof, guestRead, key } = context;
	const { evaluate, until } = agentUiDriver(options);
	const report = {
		available: await evaluate(
			"Boolean(document.querySelector('[data-workstation-browser-pane] button[aria-label=\"More options\"]'))",
		),
	};
	const save = () =>
		writeFileSync(
			join(output, "browser-tools-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	save();
	assert.equal(
		report.available,
		true,
		"original browser tools menu is available",
	);
	await evaluate(
		`(()=>{const tracked=document.querySelector('[data-workstation-browser-pane]');window.__ownedBrowserToolTrace=[];const record=(type,e)=>{const target=e?.target;const row={type,time:performance.now(),target:target?.tagName,label:target?.getAttribute?.('aria-label'),role:target?.getAttribute?.('role'),defaultPrevented:e?.defaultPrevented,menu:!!document.querySelector('[role=menu]'),menuState:document.querySelector('[role=menu]')?.dataset.state,expanded:document.querySelector('[data-workstation-browser-pane] button[aria-label=\"More options\"]')?.getAttribute('aria-expanded'),samePane:document.querySelector('[data-workstation-browser-pane]')===tracked,connected:tracked?.isConnected,active:document.activeElement?.tagName};window.__ownedBrowserToolTrace.push(row);if(window.__ownedBrowserToolTrace.length>100)window.__ownedBrowserToolTrace.shift();};for(const type of ['pointerdown','pointerup','click','focusin','focusout','menu.itemSelect'])document.addEventListener(type,e=>{record(type,e);queueMicrotask(()=>record(type+':after',e));},true);let previous=!!document.querySelector('[role=menu]');new MutationObserver(()=>{const next=!!document.querySelector('[role=menu]');if(next!==previous){previous=next;record('menu-mutation');}}).observe(document.body,{childList:true,subtree:true});return true;})()`,
	);
	try {
		const { open, select: menu } = workstationBrowserMenuDriver(options);
		const state = async () => {
			const rows = await inspectBrowserTools();
			assert.equal(rows.length, 1);
			return rows[0];
		};
		const expectZoom = async (factor) =>
			until(async () => {
				const row = await state();
				return Math.abs(row.zoom - factor) < 0.001 ? row : null;
			}, "actual guest zoom factor");
		await open();
		report.items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		assert.ok(report.items.includes("Print"));
		assert.ok(report.items.includes("Open DevTools"));
		for (const unsupported of [
			"Take a screenshot",
			"Import cookies and passwords…",
			"Downloads",
			"Screenshots",
		])
			assert.ok(!report.items.includes(unsupported));
		await screenshot("browser-tools-original-menu");
		await menu("Copy URL");
		await until(
			async () => (await readClipboardText()) === url,
			"OS clipboard holds original canonical browser URL",
		);
		report.copiedUrl = await readClipboardText();
		save();
		report.beforeZoom = {
			state: await state(),
			viewport: await guestRead("({width:innerWidth,ratio:devicePixelRatio})"),
		};
		await open();
		await click('button[aria-label="Zoom in"]');
		report.zoomed = {
			state: await expectZoom(1.1),
			viewport: await until(async () => {
				const value = await guestRead(
					"({width:innerWidth,ratio:devicePixelRatio})",
				);
				return value.width < report.beforeZoom.viewport.width ? value : null;
			}, "zoom applied to the real page viewport"),
		};
		save();
		assert.ok(report.zoomed.viewport.width < report.beforeZoom.viewport.width);
		await screenshot("browser-tools-zoomed");
		await click('button[aria-label="Zoom out"]');
		await expectZoom(1);
		const point = await evaluate(
			"(()=>{const e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim().startsWith('Zoom'));const r=e.getBoundingClientRect();return {x:r.left+20,y:r.top+r.height/2};})()",
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		const press = async (key, code, n) => {
			for (const type of ["keyDown", "keyUp"])
				await getPage().call("Input.dispatchKeyEvent", {
					type,
					key,
					code,
					windowsVirtualKeyCode: n,
				});
		};
		await press("ArrowRight", "ArrowRight", 39);
		await expectZoom(1.1);
		await press("ArrowLeft", "ArrowLeft", 37);
		await expectZoom(1);
		await press("ArrowRight", "ArrowRight", 39);
		await expectZoom(1.1);
		await press("0", "Digit0", 48);
		report.resetZoom = await expectZoom(1);
		await key("Escape", "Escape");
		await open();
		const guestPoint = await evaluate(
			"(()=>{const r=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible').getBoundingClientRect();return {x:r.left+20,y:r.top+150};})()",
		);
		report.beforeOutside = await evaluate(
			`(()=>{const m=document.querySelector('[role=menu]'),v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible'),hit=document.elementFromPoint(${guestPoint.x},${guestPoint.y});return {state:m?.dataset.state,animations:m?.getAnimations().map(a=>a.playState),passthrough:document.documentElement.hasAttribute('data-pointer-passthrough'),guestPointerEvents:v?.style.pointerEvents,hit:hit?.tagName,role:hit?.getAttribute('role'),classes:typeof hit?.className==='string'?hit.className:null};})()`,
		);
		save();
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...guestPoint,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		await until(
			() => evaluate("!document.querySelector('[role=menu]')"),
			"click over the guest dismisses original menu through pointer passthrough",
		);
		const before = (await readProof()).requests.filter((p) =>
			p.startsWith("/preview?"),
		).length;
		await open();
		await menu("Hard reload");
		report.hardReload = await until(async () => {
			const p = await readProof();
			return p.requests.filter((p) => p.startsWith("/preview?")).length > before
				? p
				: null;
		}, "hard reload reaches actual owned HTTP server");
		await until(
			async () =>
				!(await evaluate("Boolean(document.querySelector('[role=menu]'))")),
			"hard reload menu closes",
		);
		await open();
		await menu("Open DevTools");
		report.devTools = await until(async () => {
			const row = await state();
			return row.devToolsOpened &&
				row.devToolsId &&
				row.devToolsUrl?.startsWith("devtools://") &&
				!row.devToolsLoading
				? row
				: null;
		}, "detached guest DevTools actually opens");
		save();
		try {
			report.devToolsFrontend = await until(async () => {
				const value = await inspectBrowserDevTools(report.devTools.id);
				report.devToolsFrontend = value;
				save();
				return value.treeItems > 0 && value.text.includes(marker)
					? value
					: null;
			}, "detached DevTools displays this owned page marker before capture");
			const base64 = await captureBrowserDevTools(report.devTools.id);
			assert.ok(base64.length > 1000);
			writeFileSync(
				join(output, "browser-tools-detached-devtools.png"),
				Buffer.from(base64, "base64"),
			);
		} finally {
			await closeBrowserDevTools(report.devTools.id);
		}
		await until(
			async () => !(await state()).devToolsOpened,
			"owned detached DevTools closed after capture",
		);
		await getPage().call("Page.bringToFront");
		await open();
		await menu("Browser settings");
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-settings] #browser-homepage'))",
				),
			"browser menu opens actual settings dialog after dismissal",
		);
		report.settings = await until(async () => {
			const value = await evaluate(
				"(()=>{const e=document.querySelector('#browser-homepage'),d=document.querySelector('[data-workstation-settings]');const r=e.getBoundingClientRect(),dr=d.getBoundingClientRect();return {top:r.top,bottom:r.bottom,dialogTop:dr.top,dialogBottom:dr.bottom,focused:document.activeElement?.id,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e};})()",
			);
			return value.focused === "browser-homepage" && value.hit ? value : null;
		}, "browser setting is focused and visibly receives pointer input");
		assert.ok(
			report.settings.top >= report.settings.dialogTop &&
				report.settings.bottom <= report.settings.dialogBottom,
		);
		assert.equal(report.settings.focused, "browser-homepage");
		assert.equal(report.settings.hit, true);
		await screenshot("browser-tools-settings");
		await key("Escape", "Escape");
		await until(
			() => evaluate("!document.querySelector('[data-workstation-settings]')"),
			"settings dialog closes normally",
		);
		report.after = await state();
		report.errors = getPage().errors;
		assert.deepEqual(report.errors, []);
		save();
		return report;
	} finally {
		report.events = await evaluate("window.__ownedBrowserToolTrace??[]");
		save();
	}
}
