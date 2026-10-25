import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
const label = "Import cookies and passwords…",
	hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function driver(options) {
	const defaultId = JSON.parse(
		readFileSync(resolve(options.output, "../import-fixture.json")),
	).defaultId;
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options),
		rows = () => evaluate("window.directWorkstation.browser.history.getAll()");
	const press = async (point) => {
		assert.ok(point);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await options.getPage().call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
	};
	const open = async () => {
		await menu.open();
		const items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		return {
			items,
			show: async () => {
				assert.ok(
					items.includes(label),
					"original browser import menu action is available",
				);
				await menu.select(label);
				await until(
					() =>
						evaluate(
							"(()=>{const d=[...document.querySelectorAll('[role=dialog]')].find(e=>e.querySelector('h2')?.textContent==='Import settings from another browser');return d&&d.getAnimations().every(a=>a.playState==='finished')&&!!document.getElementById('import-history');})()",
						),
					"original import dialog and detected profiles are visible",
				);
				await until(
					() =>
						evaluate(
							`document.getElementById(${JSON.stringify(defaultId)})?.dataset.state==='checked'`,
						),
					"original default profile selection is ready",
				);
			},
		};
	};
	const close = async () => {
		await options.click("text:Cancel");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"import dialog closes",
		);
	};
	return { evaluate, until, rows, press, open, close };
}
function sourceFilesUnchanged(fixture) {
	for (const f of fixture.sourceFiles)
		assert.equal(
			hash(readFileSync(f.path)),
			f.sha256,
			"source browser files stay byte-identical",
		);
}
export async function verifyWorkstationBrowserImportUi(options, context) {
	const { evaluate, until, rows, press, open, close } = driver(options),
		fixture = JSON.parse(
			readFileSync(resolve(options.output, "../import-fixture.json")),
		),
		identity = JSON.parse(
			readFileSync(join(options.output, "observed-identity.json")),
		),
		report = { fixture };
	const save = () =>
		writeFileSync(
			join(options.output, "browser-import-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const navigate = async (target) => {
		await options.click("[data-workstation-browser-toolbar] button.group");
		await until(
			() =>
				evaluate(
					"document.activeElement?.matches('[data-workstation-browser-toolbar] input')",
				),
			"address editor focused",
		);
		await context.key("a", "KeyA", process.platform === "darwin" ? 4 : 2);
		await options.getPage().call("Input.insertText", { text: target });
		await context.key("Enter", "Enter");
	};
	const importFinished = async () => {
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"real import completes and original dialog closes",
		);
	};
	try {
		assert.equal(identity.appData, fixture.configRoot);
		report.capability = await evaluate(
			"Boolean(window.directWorkstation.browser?.importData)",
		);
		report.before = await rows();
		assert.ok(
			!report.before.some((row) => row.url.includes(fixture.marker)),
			"browser records are not imported automatically",
		);
		const first = await open();
		report.items = first.items;
		save();
		await first.show();
		assert.equal(report.capability, true);
		report.sources = await evaluate(
			"window.directWorkstation.browser.importData.getSources()",
		);
		assert.deepEqual(
			report.sources.sources.map((p) => p.id).sort(),
			[fixture.defaultId, fixture.emptyId].sort(),
		);
		assert.equal(report.sources.needsFullDiskAccess, false);
		report.copy = await evaluate(
			"document.querySelector('[role=dialog]')?.textContent",
		);
		assert.ok(report.copy.includes("into Superset Remix."));
		report.controls = await evaluate(
			"(()=>{const h=document.getElementById('import-history'),c=document.getElementById('import-logins');return {history:h.dataset.state,cookies:c.dataset.state,cookiesDisabled:c.disabled||c.getAttribute('aria-disabled')==='true'};})()",
		);
		assert.deepEqual(report.controls, {
			history: "checked",
			cookies: "unchecked",
			cookiesDisabled: true,
		});
		await options.click("#import-history");
		assert.equal(
			await evaluate(
				"[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Import')?.disabled",
			),
			true,
		);
		await options.click("#import-history");
		await options.screenshot("browser-import-source-choice");
		await close();
		assert.deepEqual(await rows(), report.before);
		await navigate(fixture.url);
		await until(
			() =>
				context.guestRead(
					`document.body.innerText.includes(${JSON.stringify(fixture.marker)})`,
				),
			"owned imported URL visited before merge",
		);
		report.live = await until(
			async () =>
				(await rows()).find(
					(row) =>
						row.url === fixture.url && row.title === "Owned imported page 中文",
				),
			"live record and original title recorded",
		);
		assert.ok(report.live.visitCount < 99);
		await navigate(context.url);
		await until(
			() =>
				context.guestRead(
					`document.body.innerText.includes(${JSON.stringify(context.marker)})`,
				),
			"original fixture page restored",
		);
		const empty = await open();
		await empty.show();
		await press(
			await evaluate(
				`(()=>{const e=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.htmlFor===${JSON.stringify(fixture.emptyId)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
			),
		);
		await until(
			() =>
				evaluate(
					`document.getElementById(${JSON.stringify(fixture.emptyId)})?.dataset.state==='checked'`,
				),
			"empty source is actually selected",
		);
		report.beforeEmpty = await rows();
		await options.click("text:Import");
		await importFinished();
		assert.deepEqual(await rows(), report.beforeEmpty);
		await until(
			() =>
				evaluate(
					"[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('Could not import from browser'))",
				),
			"empty source reports no import",
		);
		await options.screenshot("browser-import-empty-source");
		const list = await open();
		await list.show();

		report.beforeLiveMerge = (await rows()).find(
			(row) => row.url === fixture.url,
		);
		await options.click("text:Import");
		await importFinished();
		report.imported = await until(async () => {
			const r = (await rows()).filter((row) =>
				row.url.includes(fixture.marker),
			);
			return r.length === fixture.entryCount ? r : null;
		}, "original Chromium reader imports every owned source row");
		const merged = report.imported.find((row) => row.url === fixture.url);
		assert.equal(merged.id, report.live.id);
		assert.equal(merged.title, report.live.title);
		assert.equal(merged.lastVisitedAt, report.beforeLiveMerge.lastVisitedAt);
		assert.equal(merged.visitCount, 99);
		await until(
			() =>
				evaluate(
					"[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('Imported 202 history items'))",
				),
			"original import success toast",
		);
		await options.screenshot("browser-import-completed");
		const repeat = await open();
		await repeat.show();
		await options.click("text:Import");
		await importFinished();
		report.reimported = (await rows()).filter((row) =>
			row.url.includes(fixture.marker),
		);
		assert.deepEqual(
			report.reimported,
			report.imported,
			"repeat imports preserve IDs, times and counters",
		);
		report.rejected = await evaluate(
			`(async()=>{try{await window.directWorkstation.browser.importData.importHistory({sourceId:${JSON.stringify(resolve(options.output, "../outside-profile"))}});return {rejected:false};}catch(error){return {rejected:true,message:error.message};}})()`,
		);
		assert.equal(report.rejected.rejected, true);
		assert.deepEqual(
			(await rows()).filter((row) => row.url.includes(fixture.marker)),
			report.imported,
		);
		await menuHistory();
		async function menuHistory() {
			const menu = workstationBrowserMenuDriver(options);
			await menu.open();
			await menu.select("History");
			await until(
				() =>
					evaluate(
						"document.querySelector('[role=dialog] h2')?.textContent==='History'",
					),
				"original history gallery after import",
			);
			const point = await until(
				() =>
					evaluate(
						`(()=>{const e=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('Owned imported page 中文')&&b.textContent.includes(${JSON.stringify(fixture.url)}));if(!e)return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit)?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
					),
				"imported history row is visible and hit-testable",
			);
			await options.screenshot("browser-import-history");
			await press(point);
			await until(
				() => evaluate("!document.querySelector('[role=dialog]')"),
				"imported history selection closes dialog",
			);
		}
		await until(
			() =>
				context.guestRead(
					`document.body.innerText.includes(${JSON.stringify(fixture.marker)})`,
				),
			"selected imported row navigates to real owned HTTP content",
		);
		report.afterSelection = await until(
			async () =>
				(await rows()).find(
					(row) => row.url === fixture.url && row.visitCount > 99,
				),
			"selected imported URL receives a real visit",
		);
		sourceFilesUnchanged(fixture);
		report.sourceFilesUnchanged = true;
		await navigate(context.url);
		await until(
			() =>
				context.guestRead(
					`document.body.innerText.includes(${JSON.stringify(context.marker)})`,
				),
			"normal browser flow restored after import",
		);
		report.errors = options.getPage().errors;
		assert.deepEqual(report.errors, []);
		return report;
	} catch (error) {
		report.failure = {
			name: error.name,
			message: error.message,
			actual: error.actual,
			expected: error.expected,
		};
		throw error;
	} finally {
		if (!report.errors) await options.screenshot("browser-import-incomplete");
		save();
		if (
			await evaluate(
				"document.querySelector('[role=dialog] h2')?.textContent==='Import settings from another browser'",
			)
		)
			await close();
		else if (
			await evaluate(
				"document.querySelector('[role=dialog] h2')?.textContent==='History'",
			)
		) {
			await options.click("[role=dialog] [data-slot=dialog-close]");
			await until(
				() => evaluate("!document.querySelector('[role=dialog]')"),
				"failed history selection dialog closes for cleanup",
			);
		}
	}
}
export async function verifyWorkstationBrowserImportReopened(
	options,
	expected,
) {
	const { rows, open, close, evaluate } = driver(options),
		report = {};
	try {
		report.rows = (await rows()).filter((row) =>
			row.url.includes(expected.fixture.marker),
		);
		assert.equal(report.rows.length, expected.fixture.entryCount);
		assert.equal(
			report.rows.find((row) => row.url === expected.fixture.url)?.id,
			expected.afterSelection.id,
		);
		assert.equal(
			report.rows.find((row) => row.url === expected.fixture.url)?.visitCount,
			expected.afterSelection.visitCount,
		);
		sourceFilesUnchanged(expected.fixture);
		report.sourceFilesUnchanged = true;
		const list = await open();
		await list.show();
		await options.screenshot("browser-import-reopened");
		await close();
		return report;
	} finally {
		writeFileSync(
			join(options.output, "browser-import-reopened.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
		if (
			await evaluate(
				"document.querySelector('[role=dialog] h2')?.textContent==='Import settings from another browser'",
			)
		)
			await close();
	}
}
