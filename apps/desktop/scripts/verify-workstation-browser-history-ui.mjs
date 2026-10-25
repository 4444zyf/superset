import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";

function driver(options) {
	const { evaluate, until, replace } = agentUiDriver({
			...options,
			rootSelector: "[role=dialog]",
		}),
		menu = workstationBrowserMenuDriver(options);
	const rows = () =>
		evaluate(
			"[...document.querySelectorAll('[role=dialog] button.flex.w-full')].map(e=>({title:e.querySelector('.text-foreground')?.textContent,url:e.querySelector('.text-xs')?.textContent}))",
		);
	const open = async () => {
		await menu.open();
		const items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		return {
			items,
			show: async () => {
				assert.ok(
					items.includes("History"),
					"original History menu action is available",
				);
				await menu.select("History");
				await until(
					() =>
						evaluate(
							"(()=>{const e=document.querySelector('[role=dialog] input[placeholder=\"Search history\"]'),d=e?.closest('[role=dialog]');if(!e||!d||!d.getAnimations().every(a=>a.playState==='finished'))return false;const r=e.getBoundingClientRect();return document.activeElement===e&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()",
						),
					"original focused history dialog",
				);
			},
		};
	};
	const close = async () => {
		await options.click("[role=dialog] [data-slot=dialog-close]");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"history dialog exit animation",
		);
	};
	const select = async (url) => {
		const point = await until(
			() =>
				evaluate(
					`(()=>{const e=[...document.querySelectorAll('[role=dialog] button.flex.w-full')].find(e=>e.querySelector('.text-xs')?.textContent===${JSON.stringify(url)});if(!e)return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e.contains(hit)?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
				),
			"visible history entry",
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
			"history selection dismisses original dialog",
		);
	};
	return { evaluate, until, replace, rows, open, close, select };
}

export async function verifyWorkstationBrowserHistoryUi(options, context) {
	const { getPage, screenshot, output, click } = options,
		{ url, proof, marker, guestRead, key, readProof } = context;
	const { evaluate, until, replace, rows, open, close, select } =
		driver(options);
	const next = `http://localhost:${proof.port}/next?value=%E4%B8%AD%20hello#section`;
	const report = { homeUrl: url, nextUrl: next };
	const save = () =>
		writeFileSync(
			join(output, "browser-history-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	try {
		// Explicit owned SQLite fixture setup, equivalent to imported old rows. The
		// actual visited home/next records must fall outside the 500-row recent cap.
		report.fixture = await evaluate(
			`(async()=>{const h=window.directWorkstation.browser.history;for(let i=0;i<501;i++)await h.upsert({url:${JSON.stringify(`http://localhost:${proof.port}/fixture-history-fill/`)}+i,title:${JSON.stringify(`Owned imported filler ${marker} `)}+i});const r=await h.getAll();return {inserted:501,recentCount:r.length,homeInRecents:r.some(e=>e.url===${JSON.stringify(url)}),nextInRecents:r.some(e=>e.url===${JSON.stringify(next)})};})()`,
		);
		assert.equal(report.fixture.recentCount, 500);
		assert.equal(report.fixture.homeInRecents, false);
		assert.equal(report.fixture.nextInRecents, false);
		const first = await open();
		report.items = first.items;
		save();
		await first.show();
		report.recents = await until(async () => {
			const r = await rows();
			return r.length === 500 ? r : null;
		}, "original recent-history list");
		await screenshot("browser-history-recents");
		const input = '[role=dialog] input[placeholder="Search history"]';
		await replace(input, "owned-no-history-match-unique");
		await until(
			() =>
				evaluate(
					"document.querySelector('[role=dialog]')?.textContent.includes('No matches')",
				),
			"history search empty state",
		);
		await replace(input, "home 中文");
		report.search = await until(async () => {
			const r = await rows();
			return r.length === 1 && r[0].url === url ? r : null;
		}, "whole-table search finds actual visited page beyond recent cap");
		await screenshot("browser-history-search");
		await select(url);
		report.selected = await until(async () => {
			const title = await guestRead("document.title");
			return title === "Owned browser home 中文 🙂"
				? { title, url: await guestRead("location.href") }
				: null;
		}, "selected original history URL navigates real guest");
		const before = await readProof();
		const navigate = async (target) => {
			await click("[data-workstation-browser-toolbar] input");
			await key("a", "KeyA", process.platform === "darwin" ? 4 : 2);
			await getPage().call("Input.insertText", { text: target });
			await key("Enter", "Enter");
		};
		await navigate(next);
		await until(
			async () =>
				(await guestRead("document.title")) === "Owned browser next 中文 🙂" &&
				(await readProof()).requests.length > before.requests.length,
			"real next navigation after history selection",
		);
		const second = await open();
		await second.show();
		await until(
			async () => (await rows()).some((r) => r.url === next),
			"next visit visible before clearing",
		);
		await click("text:Clear history");
		await until(
			() =>
				evaluate(
					"document.querySelector('[role=dialog]')?.textContent.includes('No history yet')",
				),
			"clear action empties original dialog",
		);
		report.afterClear = await evaluate(
			"window.directWorkstation.browser.history.getAll()",
		);
		assert.deepEqual(report.afterClear, []);
		await screenshot("browser-history-cleared");
		await close();
		const beforeRevisit = await readProof();
		await navigate(next);
		await until(
			async () =>
				(await readProof()).requests.length > beforeRevisit.requests.length &&
				(await guestRead("document.title")) === "Owned browser next 中文 🙂",
			"actual revisit repopulates cleared history",
		);
		await until(
			() =>
				evaluate(
					`window.directWorkstation.browser.history.getAll().then(r=>r.some(e=>e.url===${JSON.stringify(next)}))`,
				),
			"revisit persisted to original SQLite history",
		);
		const last = await open();
		await last.show();
		report.afterRevisit = await until(async () => {
			const r = await rows();
			return r.length === 1 && r[0].url === next ? r : null;
		}, "only the new visit remains after clear");
		await close();
		report.errors = getPage().errors;
		assert.deepEqual(report.errors, []);
		return report;
	} finally {
		report.finalRows = await rows();
		report.alerts = await evaluate(
			"[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)",
		);
		save();
	}
}

export async function verifyWorkstationBrowserHistoryReopened(
	options,
	expected,
) {
	const { rows, open, close, until } = driver(options);
	const menu = await open();
	await menu.show();
	const result = await until(async () => {
		const r = await rows();
		return r.some((e) => e.url === expected.nextUrl) &&
			!r.some(
				(e) =>
					e.url === expected.homeUrl ||
					e.url.includes("/fixture-history-fill/"),
			)
			? r
			: null;
	}, "clear and later real visits survive normal app reopen");
	await options.screenshot("browser-history-reopened");
	await close();
	return result;
}
