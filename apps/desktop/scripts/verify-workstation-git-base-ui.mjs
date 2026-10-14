import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationGitBaseUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let i = 0; i < 150; i++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error("Base branch UI acceptance did not complete");
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const view=(await window.directWorkstation.getWorkspaceView()).snapshot;const target=view.targets.find(t=>t.connectionId===view.activeConnectionId);return {descriptor:d,workspaceId:target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId};})()`,
	);
	const query = (path) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.descriptor.connectionId, generation: scope.descriptor.generation, path, type: "query", input: { workspaceId: scope.workspaceId } })})`,
		);
	await click("text:Files");
	await click("text:Changes");
	const trigger = await until(() =>
		evaluate(
			`(()=>{const row=document.querySelector('[data-base-branch]');const e=[...row?.querySelectorAll('button')??[]].find(e=>e.textContent.trim()==='main'&&!e.disabled);return Boolean(e);})()`,
		),
	);
	assert.equal(trigger, true);
	await click("[data-base-branch] button:not([data-slot=button])");
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=dialog]'))"),
	);
	const point = await evaluate(
		"(()=>{const e=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.trim()==='main');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
	);
	for (const type of ["mousePressed", "mouseReleased"])
		await getPage().call("Input.dispatchMouseEvent", {
			type,
			button: "left",
			clickCount: 1,
			...point,
		});
	await until(
		async () => (await query("git.getBaseBranch")).baseBranch === "main",
	);
	await screenshot("git-original-base-branch-selected");
	await click("text:Against base");
	const file = '[data-git-path="feature-native.txt"] button';
	await until(() =>
		evaluate(
			`document.querySelector(${JSON.stringify(file)})?.disabled===false`,
		),
	);
	await click(file);
	await until(() =>
		evaluate(
			"document.querySelector('[data-remote-git-diff] diffs-container')?.shadowRoot?.querySelector('[data-line][data-line-type*=addition]')?.textContent",
		),
	);
	await screenshot("git-original-against-selected-base");
	const auto = "[data-base-branch] button[data-slot=button]";
	await until(() =>
		evaluate(
			`document.querySelector(${JSON.stringify(auto)})?.disabled===false`,
		),
	);
	await click(auto);
	await until(
		async () => (await query("git.getBaseBranch")).baseBranch === null,
	);
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-git-base-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalBaseBranchSelector: true,
				selectedBase: "main",
				configurationConfirmedByBackend: true,
				againstBaseDiffOpened: true,
				autoRestored: true,
			},
			null,
			2,
		) + "\n",
	);
}
