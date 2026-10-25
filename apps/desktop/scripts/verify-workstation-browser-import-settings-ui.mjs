import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import {
	prepareSourceFiles,
	sourceFilesUnchanged,
} from "./verify-workstation-browser-import-ui.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
export async function verifyWorkstationBrowserImportSettingsUi(
	options,
	context,
) {
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const fixture = JSON.parse(
			readFileSync(resolve(options.output, "../import-fixture.json")),
		),
		report = { fixture, scrolls: [] };
	const save = () =>
		writeFileSync(
			join(options.output, "browser-import-settings-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const rows = () =>
		evaluate("window.directWorkstation.browser.history.getAll()");
	const press = async ({ x, y }) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await options.getPage().call("Input.dispatchMouseEvent", {
				type,
				x,
				y,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
	};
	const importSelector = "[role=dialog]:not([data-workstation-settings])";
	const ready = () =>
		until(
			() =>
				evaluate(
					`(()=>{const d=document.querySelector('${importSelector}');return d?.dataset.state==='open'&&d.getAnimations().every(a=>a.playState==='finished')&&document.getElementById(${JSON.stringify(fixture.defaultId)})?.dataset.state==='checked';})()`,
				),
			"one original import dialog ready",
		);
	const geometry = (selector) =>
		evaluate(
			`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),d=document.querySelector('[data-workstation-settings]');if(!e||!d)return null;const r=e.getBoundingClientRect(),dr=d.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x+r.width/2,y:r.y+r.height/2,top:r.top,bottom:r.bottom,min:Math.max(0,dr.top)+8,max:Math.min(innerHeight,dr.bottom)-8,wheelX:dr.right-20,wheelY:Math.max(0,dr.top)+Math.min(innerHeight,dr.height)/2,scrollTop:d.scrollTop,front:hit===e||e.contains(hit)};})()`,
		);
	const expose = async (selector) => {
		for (let i = 0; i < 30; i++) {
			const g = await geometry(selector);
			report.scrolls.push({ selector, geometry: g });
			save();
			assert.ok(g, "settings action exists");
			if (g.top >= g.min && g.bottom <= g.max && g.front) return g;
			await options.getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: g.wheelX,
				y: g.wheelY,
				deltaX: 0,
				deltaY: g.top < g.min ? -500 : 500,
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw Error(
			"Original settings action could not receive real input: " + selector,
		);
	};
	try {
		const identity = JSON.parse(
			readFileSync(join(options.output, "observed-identity.json")),
		);
		assert.equal(identity.appData, fixture.configRoot);
		prepareSourceFiles(options.output, fixture, context.url);
		report.before = await rows();
		assert.equal(
			report.before.some((row) => row.url.includes(fixture.marker)),
			false,
		);
		await menu.open();
		report.menu = await menu.select("Browser settings");
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-settings] #browser-homepage'))",
				),
			"actual browser settings opens",
		);
		await until(
			() =>
				evaluate(
					"document.activeElement?.id==='browser-homepage'&&document.querySelector('[data-workstation-settings]').getAnimations().every(a=>a.playState==='finished')",
				),
			"browser settings entry focus and animation ready",
		);
		report.settings = await evaluate(
			"({titles:[...document.querySelectorAll('[role=dialog] h2')].map(e=>e.textContent),text:document.querySelector('[data-workstation-browser-preferences]')?.textContent,importButtons:[...document.querySelectorAll('[data-workstation-settings] button')].filter(b=>b.textContent==='Import…').length})",
		);
		save();
		await options.screenshot("browser-import-settings-before");
		assert.equal(
			report.settings.importButtons,
			1,
			"original Import… row is available in Browser settings",
		);
		assert.ok(report.settings.text.includes("into Superset Remix."));
		const index = await evaluate(
			"[...document.querySelectorAll('[data-workstation-settings] button')].findIndex(b=>b.textContent==='Import…')",
		);
		const buttonSelector = await evaluate(
			`(()=>{const b=[...document.querySelectorAll('[data-workstation-settings] button')][${index}];return b?"[data-workstation-browser-preferences] button."+[...b.classList].map(c=>CSS.escape(c)).join('.'):null;})()`,
		);
		assert.ok(buttonSelector);
		report.importGeometry = await expose(buttonSelector);
		await press(report.importGeometry);
		await ready();
		report.overSettings = await evaluate(
			"({titles:[...document.querySelectorAll('[role=dialog] h2')].map(e=>e.textContent),historyCheckboxes:document.querySelectorAll('#import-history').length,selected:document.querySelector('[role=radio][data-state=checked]')?.id})",
		);
		assert.deepEqual(report.overSettings.titles, [
			"Settings",
			"Import settings from another browser",
		]);
		assert.equal(report.overSettings.historyCheckboxes, 1);
		await options.screenshot("browser-import-settings-over-parent");
		report.parentCloseGeometry = await expose(
			"[data-workstation-settings] [data-slot=dialog-close]",
		);
		await press(report.parentCloseGeometry);
		await until(
			() => evaluate("!document.querySelector('[data-workstation-settings]')"),
			"parent settings closes with real input",
		);
		report.afterParentClose = await evaluate(
			"({titles:[...document.querySelectorAll('[role=dialog] h2')].map(e=>e.textContent),historyCheckboxes:document.querySelectorAll('#import-history').length,selected:document.querySelector('[role=radio][data-state=checked]')?.id})",
		);
		assert.deepEqual(report.afterParentClose.titles, [
			"Import settings from another browser",
		]);
		assert.equal(report.afterParentClose.selected, fixture.defaultId);
		await options.screenshot("browser-import-settings-parent-closed");
		await options.click("text:Import");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"import completes after settings parent was closed",
		);
		report.imported = (await rows()).filter((row) =>
			row.url.includes(fixture.marker),
		);
		assert.equal(report.imported.length, fixture.entryCount);
		report.afterSelection = report.imported.find(
			(row) => row.url === fixture.url,
		);
		assert.ok(report.afterSelection);
		report.afterImport = await rows();
		await menu.open();
		await menu.select("Import cookies and passwords…");
		await ready();
		report.fromMenu = await evaluate(
			"({titles:[...document.querySelectorAll('[role=dialog] h2')].map(e=>e.textContent),historyCheckboxes:document.querySelectorAll('#import-history').length})",
		);
		assert.deepEqual(report.fromMenu, {
			titles: ["Import settings from another browser"],
			historyCheckboxes: 1,
		});
		await options.click("text:Cancel");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"shared import cancels normally",
		);
		assert.deepEqual(await rows(), report.afterImport);
		sourceFilesUnchanged(fixture);
		report.sourceFilesUnchanged = true;
		report.runtimeErrors = options.getPage().errors;
		assert.deepEqual(report.runtimeErrors, []);
		await options.screenshot("browser-import-settings-complete");
		return report;
	} catch (error) {
		report.failure = { message: error.message, stack: error.stack };
		await options.screenshot("browser-import-settings-incomplete");
		throw error;
	} finally {
		save();
		for (let i = 0; i < 2; i++) {
			if (!(await evaluate("Boolean(document.querySelector('[role=dialog]'))")))
				break;
			for (const type of ["keyDown", "keyUp"])
				await options.getPage().call("Input.dispatchKeyEvent", {
					type,
					key: "Escape",
					code: "Escape",
					windowsVirtualKeyCode: 27,
				});
			await until(
				() =>
					evaluate(
						"!document.querySelector('[role=dialog][data-state=closed]')",
					),
				"dialog cleanup exit completes",
			);
		}
	}
}
