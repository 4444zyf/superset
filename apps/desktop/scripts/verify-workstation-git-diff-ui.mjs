import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationGitDiffUi({
	getPage,
	click,
	screenshot,
	output,
	closeReopen,
	ready,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let i = 0; i < 150; i++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error("Original Git diff UI acceptance did not complete");
	};
	await click("text:Files");
	await click("text:Changes");
	const button = '[data-git-path="feature-native.txt"] button';
	await until(() =>
		evaluate(
			`document.querySelector(${JSON.stringify(button)})?.disabled===false`,
		),
	);
	await click(button);
	const dom = `document.querySelector('[data-remote-git-diff="feature-native.txt"] diffs-container')`;
	const shadow = `${dom}?.shadowRoot`;
	await until(() =>
		evaluate(
			`${shadow}?.querySelector('[data-line][data-line-type*=addition]')?.textContent`,
		),
	);
	const before = await evaluate(
		`(()=>{const root=${shadow};return {removed:[...root.querySelectorAll('[data-line][data-line-type*=deletion]')].map(e=>e.textContent).join('\\n'),added:[...root.querySelectorAll('[data-line][data-line-type*=addition]')].map(e=>e.textContent).join('\\n')};})()`,
	);
	assert.ok(before.added.includes("first retained editor draft"));
	await click('button[aria-label="Unified view"]');
	await until(() =>
		evaluate(
			`${shadow}?.querySelector('pre[data-diff-type]')?.getAttribute('data-diff-type')==='single'`,
		),
	);
	await screenshot("git-original-unified-diff");
	await click('button[aria-label="Split view"]');
	await until(() =>
		evaluate(
			`${shadow}?.querySelector('pre[data-diff-type]')?.getAttribute('data-diff-type')==='split'`,
		),
	);
	const measurement = await evaluate(
		`(()=>{const e=${shadow}.querySelector('[data-line][data-line-type*=addition]');return {fontSize:getComputedStyle(e).fontSize,diffType:${shadow}.querySelector('pre').getAttribute('data-diff-type')};})()`,
	);
	assert.equal(measurement.fontSize, "17px");
	await screenshot("git-original-split-diff");
	await click('button[aria-label="Show all lines"]');
	await until(() =>
		evaluate(
			"document.querySelector('button[aria-label=\"Hide unchanged regions\"]')!==null",
		),
	);
	await click('button[aria-label="Hide unchanged regions"]');
	await click('button[aria-label="Collapse all files"]');
	await until(() =>
		evaluate(
			"document.querySelector('[data-remote-git-diff] > div[hidden]')!==null",
		),
	);
	await click('button[aria-label="Expand all files"]');
	await until(() =>
		evaluate(
			"document.querySelector('[data-remote-git-diff] > div[hidden]')===null",
		),
	);
	await click('button[aria-label="Unified view"]');
	await until(() =>
		evaluate(
			`${shadow}?.querySelector('pre[data-diff-type]')?.getAttribute('data-diff-type')==='single'`,
		),
	);
	const saved = await evaluate(
		"JSON.parse(localStorage.getItem('settings')).state",
	);
	assert.equal(saved.diffStyle, "unified");
	await click("text:Terminal");
	await closeReopen();
	await ready();
	await click("text:Files");
	await click("text:Changes");
	await until(() =>
		evaluate(
			`document.querySelector(${JSON.stringify(button)})?.disabled===false`,
		),
	);
	await click(button);
	await until(() =>
		evaluate(
			"document.querySelector('button[aria-label=\"Unified view\"]')?.getAttribute('aria-pressed')==='true'",
		),
	);
	await until(() =>
		evaluate(
			`${shadow}?.querySelector('pre[data-diff-type]')?.getAttribute('data-diff-type')==='single'`,
		),
	);
	await screenshot("git-original-diff-preference-after-reopen");
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-git-diff-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalDiffRenderer: true,
				actualContents: before,
				originalSplitUnifiedControls: true,
				editorFontMeasurement: measurement,
				contextAndCollapseControls: true,
				persistedDiffStyle: saved.diffStyle,
				reopenDiffPreferenceRetained: true,
			},
			null,
			2,
		) + "\n",
	);
}
