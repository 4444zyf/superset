import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";

export async function verifyWorkstationBrowserClearUi(options, context) {
	const { click, getPage, screenshot, output } = options,
		{ url, marker, guestRead, readProof } = context;
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const report = {};
	const save = () =>
		writeFileSync(
			join(output, "browser-clear-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const path = "/owned-cache?marker=" + encodeURIComponent(marker),
		cookieName = "owned_browser_clear";
	const cookie = () => guestRead("document.cookie");
	const fetchCache = async () => {
		const body = await guestRead(
			`fetch(${JSON.stringify(path)}).then(r=>r.text())`,
		);
		assert.ok(
			body.includes(marker),
			"cached response belongs to this owned server",
		);
		return (await readProof()).requests.filter((p) => p === path).length;
	};
	const readState = async () => ({
		cookie: await cookie(),
		history: await evaluate(
			"window.directWorkstation.browser.history.getAll()",
		),
		cacheRequests: (await readProof()).requests.filter((p) => p === path)
			.length,
	});
	const open = async () => {
		await menu.open();
		report.items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		save();
		assert.ok(
			report.items.includes("Clear browsing data"),
			"original clear-data menu action is available",
		);
		await menu.select("Clear browsing data");
		await until(
			() =>
				evaluate(
					"(()=>{const d=document.querySelector('[role=dialog] #clear-history')?.closest('[role=dialog]');return d&&d.getAnimations().every(a=>a.playState==='finished');})()",
				),
			"original clear-data dialog opens",
		);
	};
	const close = async () => {
		await click("text:Cancel");
		await until(
			() => evaluate("!document.querySelector('[role=dialog] #clear-history')"),
			"clear-data dialog closes",
		);
	};
	const choose = async (selected) => {
		for (const id of ["history", "cookies", "cache"]) {
			const checked = await evaluate(
				`document.querySelector('#clear-${id}')?.getAttribute('aria-checked')==='true'`,
			);
			if (checked !== selected.includes(id)) await click("#clear-" + id);
			assert.equal(
				await evaluate(
					`document.querySelector('#clear-${id}')?.getAttribute('aria-checked')==='true'`,
				),
				selected.includes(id),
			);
		}
	};
	const clear = async (selected, label) => {
		await open();
		await choose(selected);
		await screenshot("browser-clear-" + label + "-selection");
		await click("text:Clear data");
		await until(
			() => evaluate("!document.querySelector('[role=dialog] #clear-history')"),
			"selected clearing completes and dismisses original dialog",
		);
		report[label + "Toasts"] = await until(
			() =>
				evaluate(
					"(()=>{const r=[...document.querySelectorAll('[data-sonner-toast]')].map(e=>e.textContent);return r.some(t=>t.includes('Browsing data cleared'))?r:null;})()",
				),
			"original successful clear feedback is visible",
		);
	};
	const setCookie = () =>
		guestRead(
			`(()=>{document.cookie=${JSON.stringify(cookieName + "=" + marker + "; path=/; SameSite=Lax")};return document.cookie;})()`,
		);
	try {
		report.capability = await evaluate(
			"typeof window.directWorkstation.browser?.clearData==='function'",
		);
		await setCookie();
		report.firstCache = await fetchCache();
		report.secondCache = await fetchCache();
		assert.equal(report.firstCache, 1);
		assert.equal(
			report.secondCache,
			1,
			"real Chromium cache serves the second fetch",
		);
		report.before = await until(async () => {
			const r = await readState();
			return r.history.some((e) => e.url === url) ? r : null;
		}, "actual initial visit is in SQLite history");
		assert.ok(report.before.cookie.includes(cookieName + "=" + marker));
		await open();
		await screenshot("browser-clear-default");
		await close();
		report.cancelled = await readState();
		assert.deepEqual(report.cancelled, report.before);
		// Negative protocol diagnostic in the owned profile: private input is limited
		// to the original dialog's categories, with no "all" command accepted.
		report.invalidRejected = await evaluate(
			"window.directWorkstation.browser.clearData({type:'all'}).then(()=>false,()=>true)",
		);
		assert.equal(report.invalidRejected, true);
		assert.deepEqual(await readState(), report.before);
		await clear(["history"], "history");
		report.history = await readState();
		assert.deepEqual(report.history.history, []);
		assert.equal(report.history.cookie, report.before.cookie);
		assert.equal(await fetchCache(), 1);
		await click(
			"[data-workstation-browser-toolbar] > div > div:first-child > button:nth-child(3)",
		);
		report.reloaded = await until(async () => {
			const r = await readState();
			return r.history.some((e) => e.url === url) ? r : null;
		}, "real reload restores a visit after history-only clear");
		await clear(["cookies"], "cookies");
		report.cookies = await readState();
		assert.ok(!report.cookies.cookie.includes(cookieName + "="));
		assert.deepEqual(report.cookies.history, report.reloaded.history);
		assert.equal(await fetchCache(), 1);
		await setCookie();
		await clear(["cache"], "cache");
		report.cache = await readState();
		assert.ok(report.cache.cookie.includes(cookieName + "=" + marker));
		assert.deepEqual(report.cache.history, report.reloaded.history);
		assert.equal(
			await fetchCache(),
			2,
			"cache-only clear causes a new owned HTTP request",
		);
		await screenshot("browser-clear-cache-success");
		await open();
		await choose([]);
		report.noneDisabled = await evaluate(
			"[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.trim()==='Clear data')?.disabled",
		);
		assert.equal(report.noneDisabled, true);
		await screenshot("browser-clear-none");
		await close();
		report.errors = getPage().errors;
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
		if (!report.errors) await screenshot("browser-clear-incomplete");
		report.final = await readState();
		save();
		if (
			await evaluate(
				"Boolean(document.querySelector('[role=dialog] #clear-history'))",
			)
		)
			await close();
	}
}
