import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationBrowserPreferencesUi(options, context) {
	const { getPage, click, screenshot, output, closeReopen, controls } = options;
	const {
		scope,
		terminal,
		selector,
		proof,
		marker,
		terminalTab,
		readView,
		workspace,
		readProof,
		guestRead,
		key,
	} = context;
	const { evaluate, until, replace, scrollTo, closeEditor } = agentUiDriver({
		...options,
		rootSelector: "[data-workstation-settings]",
	});
	const prefs = () =>
		evaluate("window.directWorkstation.browser.preferences.get()");
	const view = async () => workspace(await readView());
	const report = { scope, marker, defaults: await prefs() };
	const save = () =>
		writeFileSync(
			join(output, "browser-preferences-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const settings = async () => {
		await click('button[aria-label="Settings"]');
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-settings] #browser-homepage'))",
				),
			"original browser preference controls mounted",
		);
	};
	const select = async (selector, label) => {
		await scrollTo(selector);
		await click(selector);
		const index = await until(
			() =>
				evaluate(
					`(()=>{const i=[...document.querySelectorAll('[role=option]')].findIndex(e=>e.textContent.trim()===${JSON.stringify(label)});return i>=0?i+1:null;})()`,
				),
			"original preference option",
		);
		await click(`[role=option]:nth-of-type(${index})`);
	};
	const selectTerminal = async () => {
		await click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);
		await until(
			() =>
				evaluate(
					`document.querySelector(${JSON.stringify(selector)})?.dataset.restoreState==='attached'`,
				),
			"original HTTP terminal visible",
		);
	};
	const closePane = async (pane) => {
		const point = await evaluate(
			`(()=>{const e=document.querySelector('input[data-pane-title-id="${pane.paneId}"]')?.parentElement.parentElement.querySelector('button[aria-label="Close pane"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		assert.ok(point);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		await until(
			async () => !(await view()).panes.some((p) => p.paneId === pane.paneId),
			"only selected browser removed",
		);
	};
	const browserAdded = async (before, url) =>
		until(async () => {
			const w = await view();
			return w.panes.find(
				(p) =>
					p.kind === "browser" &&
					!before.includes(p.paneId) &&
					p.browser.url === url,
			);
		}, "browser added with original canonical URL");
	const beforeTerminal = await controls.inspectPresetTerminal(terminal.id);
	report.beforeTerminal = beforeTerminal;
	assert.equal(report.defaults.invalid, false);
	assert.equal(report.defaults.values.homepageUrl, null);
	assert.deepEqual(report.defaults.values.urlLinks, {
		plain: null,
		shift: "newTab",
		meta: "pane",
		metaShift: "external",
	});
	assert.equal(report.defaults.values.portOpenAction, "external");
	const homepage = `http://localhost:${proof.port}/homepage?value=%E4%B8%AD#default`;
	const url = `http://localhost:${proof.port}/policy?value=%E4%B8%AD%20hello#fragment`;
	await evaluate(
		`window.__ownedPolicyTerminal=document.querySelector(${JSON.stringify(selector)})`,
	);
	await settings();
	await replace("#browser-homepage", homepage);
	await key("Enter", "Enter");
	await until(
		async () => (await prefs()).values.homepageUrl === homepage,
		"homepage acknowledged by private SQLite store",
	);
	await select("#links-port-action", "Open in split pane");
	await until(
		async () => (await prefs()).values.portOpenAction === "pane",
		"port split preference acknowledged",
	);
	await screenshot("browser-preferences-original-controls");
	await closeEditor();
	assert.equal(
		await evaluate(
			`window.__ownedPolicyTerminal===document.querySelector(${JSON.stringify(selector)})`,
		),
		true,
		"changing browser settings does not remount the terminal",
	);
	let before = (await view()).panes.map((p) => p.paneId);
	await click("[data-workstation-new-browser]");
	const home = await browserAdded(before, homepage);
	report.homepage = await until(async () => {
		const g = await guestRead(
			"({body:document.body.innerText,url:location.href})",
		);
		return g?.body.includes(marker) && g.url.includes("/homepage?") ? g : null;
	}, "new browser displays owned saved homepage");
	await screenshot("browser-preferences-homepage");
	await closePane(home);
	await selectTerminal();
	const activateUrl = async (modifiers) => {
		const dims = await controls.inspectPresetTerminal(terminal.id);
		const point = await evaluate(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}+' .xterm-screen').getBoundingClientRect();return {x:r.x+r.width/${dims.cols}*5.5,y:r.y+r.height/${dims.rows}*.5,cell:r.height/${dims.rows}};})()`,
		);
		const mouse = (type, y = point.y) =>
			getPage().call("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y,
				modifiers,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		await until(async () => {
			await mouse("mouseMoved", point.y + point.cell);
			await mouse("mouseMoved");
			return evaluate(
				`document.querySelector(${JSON.stringify(selector)}+' .xterm-screen').classList.contains('xterm-cursor-pointer')`,
			);
		}, "original terminal URL provider hover");
		await mouse("mousePressed");
		await mouse("mouseReleased");
		return point;
	};
	before = (await view()).panes.map((p) => p.paneId);
	report.plainPoint = await activateUrl(0);
	assert.deepEqual(
		(await view()).panes.map((p) => p.paneId),
		before,
		"default plain click is inactive",
	);
	const tabsBefore = (await view()).paneTabs.length;
	report.splitPoint = await activateUrl(process.platform === "darwin" ? 4 : 2);
	const split = await browserAdded(before, url);
	assert.equal(
		(await view()).paneTabs.length,
		tabsBefore,
		"default meta gesture splits the current tab",
	);
	report.split = await until(async () => {
		const g = await guestRead(
			"({body:document.body.innerText,url:location.href})",
		);
		return g?.body.includes(marker) && g.url.includes("/policy?") ? g : null;
	}, "terminal URL rendered in real scoped guest");
	await screenshot("browser-preferences-terminal-split");
	await closePane(split);
	await selectTerminal();
	await evaluate(
		`window.__ownedPolicyTerminal=document.querySelector(${JSON.stringify(selector)})`,
	);
	await settings();
	await select("#links-url-meta", "Open in new tab");
	await until(
		async () => (await prefs()).values.urlLinks.meta === "newTab",
		"live modifier preference acknowledged",
	);
	await closeEditor();
	assert.equal(
		await evaluate(
			`window.__ownedPolicyTerminal===document.querySelector(${JSON.stringify(selector)})`,
		),
		true,
		"live modifier change keeps the same terminal element",
	);
	before = (await view()).panes.map((p) => p.paneId);
	const tabCount = (await view()).paneTabs.length;
	report.tabPoint = await activateUrl(process.platform === "darwin" ? 4 : 2);
	const tab = await browserAdded(before, url);
	assert.equal(
		(await view()).paneTabs.length,
		tabCount + 1,
		"the same modifier now opens a new browser tab",
	);
	await until(async () => {
		const g = await guestRead("document.body.innerText");
		return g?.includes(marker);
	}, "new link tab renders HTTP response");
	await screenshot("browser-preferences-terminal-new-tab");
	await closePane(tab);
	await selectTerminal();
	await click("text:Port");
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector('[data-port="${proof.port}"] > button'))`,
			),
		"original detected-port row",
	);
	before = (await view()).panes.map((p) => p.paneId);
	const portTabs = (await view()).paneTabs.length;
	await click(`[data-port="${proof.port}"] > button:first-child`);
	const port = await browserAdded(before, `http://localhost:${proof.port}/`);
	await key("Escape", "Escape");
	report.port = await until(async () => {
		const g = await guestRead(
			"({body:document.body.innerText,url:location.href})",
		);
		return g?.body.includes(marker) && new URL(g.url).pathname === "/"
			? g
			: null;
	}, "detected port opens in scoped guest using its preference");
	assert.equal(
		(await view()).paneTabs.length,
		portTabs,
		"detected port splits current tab",
	);
	await screenshot("browser-preferences-port-split");
	await closePane(port);
	await selectTerminal();
	report.saved = await prefs();
	save();
	await closeReopen();
	await selectTerminal();
	assert.deepEqual(
		await prefs(),
		report.saved,
		"browser settings survive real close and reopen",
	);
	await settings();
	await scrollTo("#links-url-meta");
	assert.equal(
		await evaluate('document.querySelector("#browser-homepage").value'),
		homepage,
	);
	assert.equal(
		await evaluate(
			'document.querySelector("#links-url-meta").textContent.trim()',
		),
		"Open in new tab",
	);
	await screenshot("browser-preferences-reopened");
	await closeEditor();
	const retained = await controls.inspectPresetTerminal(terminal.id);
	report.retained = retained;
	for (const key of ["id", "pid", "executionId", "cwd"])
		assert.equal(
			retained[key],
			beforeTerminal[key],
			`original terminal ${key} retained`,
		);
	report.requests = (await readProof()).requests;
	report.errors = getPage().errors;
	assert.deepEqual(report.errors, []);
	save();
}
