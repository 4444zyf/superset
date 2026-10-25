import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function driver(options) {
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const snapshot = () =>
		evaluate("window.directWorkstation.browser.screenshots.getSnapshot()");
	const open = async () => {
		await menu.open();
		const items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		return {
			items,
			show: async () => {
				assert.ok(
					items.includes("Screenshots"),
					"original Screenshots menu action is available",
				);
				await menu.select("Screenshots");
				await until(
					() =>
						evaluate(
							"(()=>{const d=[...document.querySelectorAll('[role=dialog]')].find(e=>e.querySelector('h2')?.textContent==='Screenshots');return d&&d.getAnimations().every(a=>a.playState==='finished');})()",
						),
					"screenshots gallery is visible",
				);
			},
		};
	};
	const close = async () => {
		await options.click("[role=dialog] [data-slot=dialog-close]");
		await until(
			() => evaluate("!document.querySelector('[role=dialog]')"),
			"screenshots gallery closes",
		);
	};
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
	const capture = async () => {
		await menu.open();
		await menu.select("Take a screenshot");
	};
	return { evaluate, until, open, close, press, capture, snapshot };
}
async function verifyFile(options, row, directory) {
	const rel = relative(directory, row.savePath);
	assert.ok(
		rel && !isAbsolute(rel) && !rel.startsWith(".."),
		"capture stays inside owned Pictures directory",
	);
	const bytes = readFileSync(row.savePath);
	assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	const decoded = await options.inspectClipboardImage(bytes.toString("base64"));
	assert.deepEqual(decoded.size, { width: row.width, height: row.height });
	assert.equal(decoded.corner[3], 255, "captured page uses an opaque canvas");
	assert.ok(row.width > 0 && row.height > 0);
	return {
		id: row.id,
		path: row.savePath,
		bytes: bytes.length,
		sha256: hash(bytes),
		...decoded,
	};
}
export async function verifyWorkstationBrowserScreenshotsUi(options, context) {
	const { evaluate, until, open, close, press, capture, snapshot } =
			driver(options),
		report = { files: [] };
	const save = () =>
		writeFileSync(
			join(options.output, "browser-screenshots-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	try {
		report.directory = await options.readBrowserPicturesDirectory();
		assert.equal(report.directory, resolve(options.output, "../pictures"));
		report.capability = await evaluate(
			"Boolean(window.directWorkstation.browser?.screenshots&&window.directWorkstation.browser?.captureScreenshot)",
		);
		const list = await open();
		report.items = list.items;
		save();
		await list.show();
		assert.equal(report.capability, true);
		await until(
			() =>
				evaluate(
					"document.querySelector('[role=dialog]')?.textContent.includes('No screenshots yet')",
				),
			"empty original screenshot gallery",
		);
		await options.screenshot("browser-screenshots-empty");
		await close();
		const captureAndCheck = async (count) => {
			await capture();
			const rows = await until(async () => {
				const r = (await snapshot()).rows;
				return r.length === count ? r : null;
			}, "real page capture persisted");
			const row = rows.find((r) => !report.files.some((f) => f.id === r.id));
			assert.ok(row);
			const file = await verifyFile(options, row, report.directory);
			report.files.push(file);
			const clipboard = await options.readClipboardImage();
			assert.deepEqual(
				clipboard,
				{ size: file.size, pixelSha256: file.pixelSha256 },
				"system clipboard contains full capture pixels",
			);
			const preview = await until(
				() =>
					evaluate(
						"(()=>{const e=[...document.querySelectorAll('img[alt=\"Screenshot preview\"]')].at(-1);return e?.complete&&e.naturalWidth>0?{width:e.naturalWidth,height:e.naturalHeight,toast:e.closest('[data-sonner-toast]')?.textContent}:null;})()",
					),
				"real original screenshot toast and PNG preview",
			);
			assert.ok(preview.width <= 200 && preview.height <= 200);
			assert.ok(preview.toast.includes("Screenshot copied to clipboard"));
			report.lastPreview = preview;
			return row;
		};
		report.first = await captureAndCheck(1);
		assert.deepEqual(
			report.files[0].corner,
			[255, 255, 255, 255],
			"the default page canvas stays white on disk and clipboard",
		);
		await options.screenshot("browser-screenshot-clipboard");
		const point = await evaluate(
			`(async()=>{const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible'),p=await v.executeJavaScript("(()=>{const e=document.querySelector('#capture-color'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");const r=v.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};})()`,
		);
		await press(point);
		await until(
			() =>
				context.guestRead(
					"document.body.style.backgroundColor==='rgb(40, 90, 130)'",
				),
			"real page input changes captured pixels",
		);
		report.second = await captureAndCheck(2);
		assert.deepEqual(
			report.files[1].corner,
			[130, 90, 40, 255],
			"explicit page background colors stay exact",
		);
		assert.notEqual(report.files[0].pixelSha256, report.files[1].pixelSha256);
		assert.notEqual(report.first.savePath, report.second.savePath);
		await press(
			await evaluate(
				"(()=>{const e=[...document.querySelectorAll('[data-sonner-toast] button')].filter(e=>e.textContent==='View all').at(-1);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
			),
		);
		await until(
			() =>
				evaluate(
					"document.querySelector('[role=dialog] h2')?.textContent==='Screenshots'",
				),
			"original toast View all opens gallery",
		);
		report.gallery = await until(
			() =>
				evaluate(
					"(()=>{const images=[...document.querySelectorAll('[role=dialog] img')];return images.length===2&&images.every(e=>e.complete&&e.naturalWidth>0)?images.map(e=>({width:e.naturalWidth,height:e.naturalHeight})):null;})()",
				),
			"both saved thumbnails decode",
		);
		await options.screenshot("browser-screenshots-gallery");
		await press(
			await evaluate(
				`(()=>{const name=[...document.querySelectorAll('[role=dialog] .text-foreground')].find(e=>e.textContent===${JSON.stringify(report.second.filename)}),e=name?.closest('button')?.parentElement.querySelector('button[aria-label="Copy path"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
			),
		);
		report.copiedPath = await until(async () => {
			const text = await options.readClipboardText();
			return text === report.second.savePath ? text : null;
		}, "Copy path writes exact desktop file path to OS clipboard");
		await options.click("text:Clear list");
		await until(
			async () => (await snapshot()).rows.length === 0,
			"clear removes screenshot metadata",
		);
		for (const file of report.files)
			assert.equal(hash(readFileSync(file.path)), file.sha256);
		await options.screenshot("browser-screenshots-cleared");
		await close();
		report.persisted = await captureAndCheck(1);
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
		if (!report.errors)
			await options.screenshot("browser-screenshots-incomplete");
		save();
		if (
			await evaluate(
				"document.querySelector('[role=dialog] h2')?.textContent==='Screenshots'",
			)
		)
			await close();
	}
}
export async function verifyWorkstationBrowserScreenshotsReopened(
	options,
	expected,
) {
	const { until, open, close, snapshot, evaluate } = driver(options),
		report = {};
	try {
		const list = await open();
		await list.show();
		report.rows = await until(async () => {
			const r = (await snapshot()).rows;
			return r.length === 1 && r[0].id === expected.persisted.id ? r : null;
		}, "same screenshot record survives normal app reopen");
		await until(
			() =>
				evaluate(
					"(()=>{const image=document.querySelector('[role=dialog] img');return image?.complete&&image.naturalWidth>0;})()",
				),
			"persisted screenshot thumbnail decodes",
		);
		for (const file of expected.files)
			assert.equal(hash(readFileSync(file.path)), file.sha256);
		report.filesUnchanged = true;
		await options.screenshot("browser-screenshots-reopened");
		await options.click("text:Clear list");
		await until(
			async () => (await snapshot()).rows.length === 0,
			"reopened screenshot metadata clears",
		);
		for (const file of expected.files)
			assert.equal(hash(readFileSync(file.path)), file.sha256);
		return report;
	} finally {
		writeFileSync(
			join(options.output, "browser-screenshots-reopened.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
		await close();
	}
}
