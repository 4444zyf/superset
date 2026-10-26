import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import {
	prepareSourceFiles,
	sourceFilesUnchanged,
} from "./verify-workstation-browser-import-ui.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";

const banner = "[data-workstation-browser-pane] > .relative.z-20";
const fixtureAt = (options) =>
	JSON.parse(readFileSync(resolve(options.output, "../import-fixture.json")));
export function prepareBrowserImportBannerFixture(options, url) {
	prepareSourceFiles(options.output, fixtureAt(options), url);
}
function driver(options) {
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const rows = async (fixture) =>
		(await evaluate("window.directWorkstation.browser.history.getAll()"))
			.filter((row) => row.url.includes(fixture.marker))
			.sort((a, b) => a.url.localeCompare(b.url));
	const ready = () =>
		until(
			() =>
				evaluate(
					"(()=>{const d=document.querySelector('[role=dialog]');return d?.querySelector('h2')?.textContent==='Import settings from another browser'&&d.getAnimations().every(a=>a.playState==='finished')&&!!document.getElementById('import-history');})()",
				),
			"original import dialog ready",
		);
	const close = async () => {
		await options.click("text:Cancel");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"original import cancels",
		);
	};
	return { evaluate, until, menu, rows, ready, close };
}
export async function verifyWorkstationBrowserImportBannerUi(options) {
	const { evaluate, until, menu, rows, ready, close } = driver(options),
		fixture = fixtureAt(options),
		report = {
			fixture,
			manualDismiss: process.argv.includes("--banner-dismiss"),
		};
	const save = () =>
		writeFileSync(
			join(options.output, "browser-import-banner-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	try {
		report.before = await rows(fixture);
		assert.deepEqual(report.before, []);
		report.initial = await evaluate(
			`(()=>{const e=document.querySelector(${JSON.stringify(banner)});return {count:document.querySelectorAll(${JSON.stringify(banner)}).length,text:e?.textContent,rect:e&&{top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:e.getBoundingClientRect().height}};})()`,
		);
		save();
		await options.screenshot("browser-import-banner-before");
		assert.equal(
			report.initial.count,
			1,
			"original detected-browser import banner appears",
		);
		assert.ok(
			report.initial.text.includes(
				"Import your browsing history and logins from Google Chrome",
			),
		);
		await options.click(`${banner} button`);
		await ready();
		report.dialog = await evaluate(
			"({checkboxCount:document.querySelectorAll('#import-history').length,profiles:[...document.querySelectorAll('[role=dialog] [role=radio]')].map(e=>e.id)})",
		);
		assert.equal(report.dialog.checkboxCount, 1);
		assert.deepEqual(
			report.dialog.profiles.sort(),
			[fixture.defaultId, fixture.emptyId].sort(),
		);
		await options.screenshot("browser-import-banner-dialog");
		await close();
		assert.equal(
			await evaluate(
				`document.querySelectorAll(${JSON.stringify(banner)}).length`,
			),
			1,
			"cancel leaves banner available",
		);
		assert.deepEqual(await rows(fixture), []);
		if (report.manualDismiss) {
			await options.click(`${banner} button[aria-label=Dismiss]`);
			await until(
				() => evaluate(`!document.querySelector(${JSON.stringify(banner)})`),
				"explicit dismiss hides banner",
			);
			await menu.open();
			await menu.select("Import cookies and passwords…");
			await ready();
			await close();
			assert.deepEqual(await rows(fixture), []);
		} else {
			await options.click(`${banner} button`);
			await ready();
			const point = await until(
				() =>
					evaluate(
						"(()=>{const e=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Import');if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return (hit===e||e.contains(hit))?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()",
					),
				"dialog Import receives real input",
			);
			for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
				await options.getPage().call("Input.dispatchMouseEvent", {
					type,
					...point,
					button: type === "mouseMoved" ? "none" : "left",
					clickCount: 1,
				});
			await until(
				() => evaluate("!document.querySelector('[role=dialog]')"),
				"explicit history import completes",
			);
			report.imported = await rows(fixture);
			assert.equal(report.imported.length, 202);
			await until(
				() => evaluate(`!document.querySelector(${JSON.stringify(banner)})`),
				"successful import silences banner",
			);
		}
		report.finalRows = await rows(fixture);
		assert.equal(report.finalRows.length, report.manualDismiss ? 0 : 202);
		report.dismissal = await evaluate(
			"JSON.parse(localStorage.getItem('browser-import-banner-dismissals-v1'))?.state?.dismissedAt",
		);
		assert.ok(Number.isFinite(report.dismissal["browser-import-banner"]));
		assert.deepEqual(Object.keys(report.dismissal), ["browser-import-banner"]);
		sourceFilesUnchanged(fixture);
		report.sourceFilesUnchanged = true;
		report.errors = options.getPage().errors;
		assert.deepEqual(report.errors, []);
		await options.screenshot("browser-import-banner-finished");
		return report;
	} catch (error) {
		report.failure = { message: error.message, stack: error.stack };
		await options.screenshot("browser-import-banner-incomplete");
		throw error;
	} finally {
		save();
		if (await evaluate("Boolean(document.querySelector('[role=dialog]'))"))
			await close();
	}
}
export async function verifyWorkstationBrowserImportBannerReopened(
	options,
	expected,
) {
	const { evaluate, rows, menu, ready, close } = driver(options),
		report = {};
	try {
		report.banners = await evaluate(
			`document.querySelectorAll(${JSON.stringify(banner)}).length`,
		);
		assert.equal(
			report.banners,
			0,
			"dismissal survives new panes and normal app reopen",
		);
		report.rows = await rows(expected.fixture);
		assert.deepEqual(report.rows, expected.finalRows);
		sourceFilesUnchanged(expected.fixture);
		report.sourceFilesUnchanged = true;
		await menu.open();
		await menu.select("Import cookies and passwords…");
		await ready();
		await options.screenshot("browser-import-banner-reopened");
		await close();
		return report;
	} finally {
		writeFileSync(
			join(options.output, "browser-import-banner-reopened.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	}
}
