import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationProjectSettingsUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		for (let i = 0; i < 150; i++) {
			const result = await read();
			if (result) return result;
			await delay(50);
		}
		throw new Error("Project settings UI acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=v.targets.find(t=>t.connectionId===v.activeConnectionId);const workspaceId=target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId;const w=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:workspaceId,workspaceId}});return {descriptor:d,projectId:w.projectId,worktreePath:w.worktreePath};})()`,
	);
	assert.ok(scope.projectId);
	const query = () =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path: "project.get", type: "query", input: { projectId: scope.projectId } })})`,
		);
	const visible = async (selector) => {
		for (let i = 0; i < 8; i++) {
			const rect = await evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()`,
			);
			assert.ok(rect);
			if (rect.top >= 80 && rect.bottom < rect.height - 10) return;
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 850,
				y: 600,
				deltaX: 0,
				deltaY: rect.top < 80 ? -350 : 350,
			});
			await delay(50);
		}
		throw new Error("Project field is outside viewport");
	};
	const enabled = (selector) =>
		until(() =>
			evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e && !e.disabled && !e.closest('fieldset')?.disabled;})()`,
			),
		);
	const replace = async (selector, value) => {
		await enabled(selector);
		await visible(selector);
		await click(selector);
		await getPage().call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
			commands: ["selectAll"],
		});
		await getPage().call("Input.insertText", { text: value });
	};
	const blur = async () => {
		await visible("[data-project-settings] h2");
		await click("[data-project-settings] h2");
	};
	const open = async () => {
		await click(
			'[data-slot=sidebar-content] button[aria-label="Project Settings"]',
		);
		await enabled("#project-name");
	};
	const before = await query();
	await open();
	const size = await evaluate(
		"(()=>{const e=document.querySelector('[role=dialog]');return {width:e.clientWidth,scrollWidth:e.scrollWidth};})()",
	);
	assert.ok(size.scrollWidth <= size.width + 1);
	await screenshot("project-settings-original-layout");
	await replace("#project-name", "Unified Renamed");
	await blur();
	await until(async () => (await query()).name === "Unified Renamed");
	await enabled("#project-name");
	const color =
		'[data-project-settings] button[aria-label="Set color to Blue"]';
	await enabled(color);
	await visible(color);
	await click(color);
	await until(async () => Boolean((await query()).color));
	const prefixMode = "[data-project-settings] button[role=combobox]";
	await enabled(prefixMode);
	await visible(prefixMode);
	await click(prefixMode);
	await until(() =>
		evaluate(
			"[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.trim()==='Custom prefix')",
		),
	);
	const point = await evaluate(
		"(()=>{const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='Custom prefix');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
	);
	for (const type of ["mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: "left",
			clickCount: 1,
			...point,
		});
	await until(async () => (await query()).branchPrefixMode === "custom");
	await replace("[data-project-settings] input[placeholder=Prefix]", "remix");
	await blur();
	await until(async () => (await query()).branchPrefixCustom === "remix");
	await replace("#project-naming-instructions", "Use feature/ for changes");
	await blur();
	await until(
		async () =>
			(await query()).namingInstructions === "Use feature/ for changes",
	);
	await replace("#project-sparse-checkout", "packages/ui\napps/desktop");
	await blur();
	const saved = await until(async () => {
		const actual = await query();
		return actual.sparseCheckoutPaths.length === 2 ? actual : null;
	});
	assert.deepEqual(saved.sparseCheckoutPaths, ["packages/ui", "apps/desktop"]);
	await enabled("#project-name");
	await visible("#project-sparse-checkout");
	await screenshot("project-settings-sparse-checkout");
	await click("[role=dialog] button[aria-label=Close]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	await open();
	assert.equal(
		await evaluate("document.querySelector('#project-name').value"),
		"Unified Renamed",
	);
	assert.equal(
		await evaluate(
			"document.querySelector('#project-naming-instructions').value",
		),
		"Use feature/ for changes",
	);
	assert.equal(
		await evaluate("document.querySelector('#project-sparse-checkout').value"),
		"packages/ui\napps/desktop",
	);
	await screenshot("project-settings-reopened");
	await click("[role=dialog] button[aria-label=Close]");
	await until(() => evaluate("!document.querySelector('[role=dialog]')"));
	writeFileSync(
		join(output, "workstation-project-settings-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalLayout: true,
				originalColorSelector: true,
				blurSave: true,
				reopened: true,
				before,
				saved,
				worktreePathBeforeRename: scope.worktreePath,
				size,
			},
			null,
			2,
		) + "\n",
	);
}
