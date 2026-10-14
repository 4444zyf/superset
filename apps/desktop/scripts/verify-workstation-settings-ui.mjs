import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationSettingsUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	ready,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let i = 0; i < 150; i++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error(
			`Settings UI acceptance did not complete: ${await evaluate("document.body.innerText.slice(-1500)")}`,
		);
	};
	const reveal = async (selector) => {
		for (let i = 0; i < 15; i++) {
			const rect = await evaluate(
				`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); const d=document.querySelector('[data-workstation-settings]').getBoundingClientRect(); return {left:r.left,right:r.right,hit:hit===e||e.contains(hit),width:innerWidth,top:r.top,bottom:r.bottom,dialogTop:d.top,dialogBottom:d.bottom,x:d.x+d.width/2,y:d.y+d.height/2}; })()`,
			);
			assert.ok(rect, `Missing settings control: ${selector}`);
			assert.ok(
				rect.left >= 0 && rect.right <= rect.width,
				`Settings control overflows the window: ${selector}`,
			);
			if (
				rect.hit &&
				rect.top >= rect.dialogTop + 10 &&
				rect.bottom <= rect.dialogBottom - 10
			)
				return;
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: rect.x,
				y: rect.y,
				deltaX: 0,
				deltaY: rect.top < rect.dialogTop + 10 ? -420 : 420,
			});
			await delay(50);
		}
		throw new Error(`Could not scroll settings control into view: ${selector}`);
	};
	const replace = async (selector, text) => {
		await reveal(selector);
		await click(selector);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		await getPage().call("Input.insertText", { text });
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Tab",
			code: "Tab",
			windowsVirtualKeyCode: 9,
		});
	};
	const select = async (selector, option) => {
		await reveal(selector);
		await click(selector);
		await until(() =>
			evaluate(
				`[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.trim().replace(/^Aa\\s*/,'')===${JSON.stringify(option)})`,
			),
		);
		const index = await evaluate(
			`[...document.querySelectorAll('[role=option]')].findIndex(e=>e.textContent.trim().replace(/^Aa\\s*/,'')===${JSON.stringify(option)})`,
		);
		await click(`[role=option]:nth-of-type(${index + 1})`);
	};
	const preferences = () =>
		evaluate("window.directWorkstation.getPreferences()");
	const terminals = () =>
		evaluate(
			"[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,executionId:e.dataset.executionId,state:e.dataset.restoreState}))",
		);
	const before = await terminals();
	await click('button[aria-label="Settings"]');
	await until(() =>
		evaluate("Boolean(document.querySelector('[data-workstation-settings]'))"),
	);
	await replace("#editor-font-size", "17");
	await until(
		preferences,
		(value) => value.values.fontSettings.editorFontSize === 17,
	);
	await replace("#terminal-font-size", "18");
	await until(
		preferences,
		(value) => value.values.fontSettings.terminalFontSize === 18,
	);
	await select("#workstation-theme", "Light");
	await until(() =>
		evaluate("document.documentElement.classList.contains('light')"),
	);
	await select("#workstation-language", "简体中文");
	await until(() => evaluate("document.documentElement.lang==='zh-CN'"));
	await screenshot("settings-original-typography-zh-CN");
	await select("#workstation-language", "English");
	await until(() => evaluate("document.documentElement.lang==='en'"));
	await getPage().call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await until(() =>
		evaluate("!document.querySelector('[data-workstation-settings]')"),
	);
	assert.deepEqual(await terminals(), before);
	const measurements = await evaluate(
		"[...document.querySelectorAll('[data-terminal-id] .xterm-rows')].map(e=>({size:getComputedStyle(e).fontSize,family:getComputedStyle(e).fontFamily}))",
	);
	assert.equal(measurements.length, 3);
	assert.ok(measurements.every((value) => value.size === "18px"));
	const saved = await preferences();
	await screenshot("settings-live-terminals-light");
	await closeReopen();
	await ready();
	assert.deepEqual(await preferences(), saved);
	assert.deepEqual(await terminals(), before);
	assert.equal(
		await evaluate("document.documentElement.classList.contains('light')"),
		true,
	);
	await click("text:Files");
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='feature-native.txt'&&!b.disabled)",
		),
	);
	await click("text:feature-native.txt");
	const editor = await until(
		() =>
			evaluate(
				"(() => {const e=document.querySelector('.cm-content');return e && {fontSize:getComputedStyle(e).fontSize,text:e.textContent};})()",
			),
		(value) => value?.fontSize === "17px",
	);
	await screenshot("settings-live-editor-light");
	await click("text:Close file and discard draft");
	await click("text:Terminal");
	await ready();
	writeFileSync(
		join(output, "workstation-settings-ui.json"),
		`${JSON.stringify({ sourceRevision: process.env.GITHUB_SHA ?? null, sourceTest: process.argv.includes("--source-test"), physicalInput: true, preferences: saved, terminalsBefore: before, measurements, sameExecutionsAfterReopen: true, languageRoundTrip: ["zh-CN", "en"], editor }, null, 2)}\n`,
	);
}
