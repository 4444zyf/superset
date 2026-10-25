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
		closeBrowserDevTools,
	} = options;
	const { url, readProof, guestRead, key } = context;
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
	const open = async () => {
		await click(
			'[data-workstation-browser-pane] button[aria-label="More options"]',
		);
		await until(
			() => evaluate("Boolean(document.querySelector('[role=menu]'))"),
			"original browser menu opens",
		);
	};
	const menu = async (label) => {
		assert.equal(
			await evaluate(
				`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.trim()===${JSON.stringify(label)})`,
			),
			true,
			`Original browser item ${label}`,
		);
		await click("menu:" + label);
	};
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
		"Show device toolbar",
		"Take a screenshot",
		"Import cookies and passwords…",
		"Downloads",
		"Screenshots",
		"History",
		"Clear browsing data",
	])
		assert.ok(!report.items.includes(unsupported));
	await screenshot("browser-tools-original-menu");
	await menu("Copy URL");
	await until(
		async () => (await readClipboardText()) === url,
		"OS clipboard holds original canonical browser URL",
	);
	report.copiedUrl = await readClipboardText();
	report.beforeZoom = {
		state: await state(),
		viewport: await guestRead("({width:innerWidth,ratio:devicePixelRatio})"),
	};
	await open();
	await click('button[aria-label="Zoom in"]');
	report.zoomed = {
		state: await expectZoom(1.1),
		viewport: await guestRead("({width:innerWidth,ratio:devicePixelRatio})"),
	};
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
	try {
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
	report.settings = await evaluate(
		"(()=>{const e=document.querySelector('#browser-homepage'),d=document.querySelector('[data-workstation-settings]');const r=e.getBoundingClientRect(),dr=d.getBoundingClientRect();return {top:r.top,bottom:r.bottom,dialogTop:dr.top,dialogBottom:dr.bottom,focused:document.activeElement?.id};})()",
	);
	assert.ok(
		report.settings.top >= report.settings.dialogTop &&
			report.settings.bottom <= report.settings.dialogBottom,
	);
	assert.equal(report.settings.focused, "browser-homepage");
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
}
