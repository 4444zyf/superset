import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
import { createRequire } from "node:module";
const { DEVICE_PRESETS } = createRequire(import.meta.url)(
	"../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/constants.ts",
);

export async function verifyWorkstationBrowserDeviceUi(options, context) {
	const { click, getPage, screenshot, output } = options;
	const { guestRead, terminalTab, selector, readView, workspace } = context;
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const report = { presets: [] };
	const save = () =>
		writeFileSync(
			join(output, "browser-device-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const metrics = () =>
		guestRead(
			"({url:location.href,width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height,ratio:devicePixelRatio,viewportMeta:document.querySelector('meta[name=\"viewport\"]')?.content})",
		);
	const geometry = () =>
		evaluate(
			"(()=>{const pane=document.querySelector('[data-workstation-browser-pane]'),area=pane?.lastElementChild,frame=area?.firstElementChild??area,guest=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible');if(!area||!frame||!guest)return null;const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};return {area:rect(area),frame:rect(frame),guest:rect(guest),scrollTop:area.scrollTop,scrollLeft:area.scrollLeft,align:getComputedStyle(area).alignItems,justify:getComputedStyle(area).justifyContent,clip:guest.style.clipPath};})()",
		);
	const device = async (width, height) =>
		until(async () => {
			const row = await metrics();
			return row?.screenWidth === width &&
				row.screenHeight === height &&
				Math.abs(row.width - width) <= 1 &&
				Math.abs(row.height - height) <= 1
				? row
				: null;
		}, "real guest mobile viewport and screen dimensions");
	const show = async () => {
		await menu.open();
		report.items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		report.available = report.items.includes("Show device toolbar");
		save();
		assert.equal(
			report.available,
			true,
			"original device toolbar menu action is available",
		);
		await menu.select("Show device toolbar");
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-browser-device-toolbar]'))",
				),
			"original device controls visible",
		);
	};
	const choose = async (label) => {
		await click(
			"[data-workstation-browser-device-toolbar] button[role=combobox]",
		);
		const point = await until(
			() =>
				evaluate(
					`(()=>{const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(hit===e||e.contains(hit))?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
				),
			"original device option visible",
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		await until(
			() => evaluate("!document.querySelector('[role=listbox]')"),
			"device selection exit animation completed",
		);
	};
	try {
		report.before = await metrics();
		assert.ok(report.before.viewportMeta?.includes("width=device-width"));
		await show();
		report.default = await device(375, 667);
		report.defaultGeometry = await geometry();
		save();
		await screenshot("browser-device-default");
		assert.ok(
			report.defaultGeometry.frame.top >= report.defaultGeometry.area.top - 1,
			"oversized preview begins within its scrollable area",
		);
		await choose("iPhone 14 Pro");
		report.iphone = await device(393, 852);
		await screenshot("browser-device-iphone");
		await click('button[aria-label="Rotate device"]');
		report.rotated = await device(852, 393);
		await screenshot("browser-device-rotated");
		await click('button[aria-label="Rotate device"]');
		await device(393, 852);
		for (const preset of DEVICE_PRESETS) {
			await choose(preset.label);
			const row = await device(preset.width, preset.height);
			report.presets.push({
				id: preset.id,
				metrics: row,
				geometry: await geometry(),
			});
			save();
		}
		await choose("iPad Air");
		await device(820, 1180);
		report.beforeScroll = await geometry();
		save();
		await getPage().call("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: report.beforeScroll.area.right - 15,
			y: (report.beforeScroll.area.top + report.beforeScroll.area.bottom) / 2,
			deltaX: 0,
			deltaY: 180,
		});
		report.afterScroll = await until(async () => {
			const row = await geometry();
			return row.scrollTop > report.beforeScroll.scrollTop ? row : null;
		}, "responsive preview outer area actually scrolls");
		save();
		assert.ok(
			Math.abs(report.afterScroll.frame.top - report.afterScroll.guest.top) < 1,
			"hoisted guest follows scrolling preview frame",
		);
		await screenshot("browser-device-scrolled");
		await click('button[aria-label="Exit device toolbar"]');
		await until(async () => {
			const row = await metrics();
			return (
				row?.width === report.before.width &&
				row.height === report.before.height &&
				row.screenWidth === report.before.screenWidth &&
				row.screenHeight === report.before.screenHeight
			);
		}, "exit clears main-process device emulation");
		await show();
		await device(375, 667);
		const active = workspace(await readView()).activePaneTabId;
		await click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);
		await until(
			() =>
				evaluate(
					`document.querySelector(${JSON.stringify(selector)})?.dataset.restoreState==='attached'`,
				),
			"original fixture terminal visible",
		);
		await click(`[data-workstation-pane-tabs] [data-tab-id="${active}"]`);
		await until(
			() =>
				evaluate(
					"!document.querySelector('[data-workstation-browser-device-toolbar]')",
				),
			"switching away resets original temporary toolbar state",
		);
		report.afterSwitch = await until(async () => {
			const row = await metrics();
			return row?.width === report.before.width &&
				row.height === report.before.height &&
				row.screenWidth === report.before.screenWidth
				? row
				: null;
		}, "returned guest has desktop metrics");
		report.errors = getPage().errors;
		assert.deepEqual(report.errors, []);
		await screenshot("browser-device-returned-desktop");
		return report;
	} finally {
		report.finalMetrics = await metrics();
		report.finalGeometry = await geometry();
		report.alerts = await evaluate(
			"[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)",
		);
		save();
	}
}
