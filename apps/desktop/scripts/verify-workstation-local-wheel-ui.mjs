import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { verifyWorkstationWheelUi } from "./verify-workstation-wheel-ui.mjs";

export async function verifyWorkstationLocalWheelUi(options) {
	const { getPage, click, output, screenshot } = options;
	const { evaluate, until } = agentUiDriver(options);
	const name = `Local wheel ${randomUUID()}`;
	await click(".ws-local-row button:last-child");
	await until(
		() =>
			evaluate(
				`Boolean([...document.querySelectorAll('.ws-heading-actions button')].find(b=>b.textContent.trim()==='New session'&&!b.disabled))`,
			),
		"local device connected",
	);
	const local = await evaluate(
		`(async()=>{const p=(await window.directWorkstation.list()).find(p=>p.kind==='local');const setup=await window.directWorkstation.getSetupSnapshot(p.id);return {profile:p,setup};})()`,
	);
	assert.equal(local.setup.status, "completed");
	assert.equal(
		local.setup.generation,
		1,
		"fresh profile has exactly one explicit connection",
	);
	// Read the actual current descriptor without reconnecting or launching any resource.
	const descriptor = await evaluate(
		`window.directWorkstation.refreshFeatures({connectionId:${JSON.stringify(local.profile.id)},generation:1})`,
	);
	assert.equal(descriptor.backendId, local.profile.backendId);
	assert.equal(descriptor.namespaceId, local.profile.namespaceId);
	await click("text:New session");
	await click("[role=dialog] input");
	await getPage().call("Input.insertText", { text: name });
	await click("[role=dialog] button[type=submit]");
	await until(
		() =>
			evaluate(
				`Boolean(document.querySelector('.ws-workspace-window'))||Boolean(document.querySelector('.editor-heading h1')?.textContent===${JSON.stringify(name)})`,
			),
		"local session editor",
	);
	if (await evaluate(`Boolean(document.querySelector('.ws-editor-tabs'))`))
		await click(".ws-editor-tabs button:last-of-type");
	const workspaces = await evaluate(
		`window.directWorkstation.rpc(${JSON.stringify({ connectionId: descriptor.connectionId, generation: descriptor.generation, path: "workspace.list", type: "query", input: {} })})`,
	);
	const workspace = workspaces.find((w) => w.name === name);
	assert.ok(workspace?.worktreePath);
	const scope = {
		d: { ...descriptor, kind: "local" },
		w: { workspaceId: workspace.id, panes: [] },
		root: workspace.worktreePath,
	};
	writeFileSync(
		join(output, "local-wheel-target.json"),
		JSON.stringify({ profile: local.profile, descriptor, workspace }, null, 2) +
			"\n",
	);
	await screenshot("local-wheel-editor-before");
	if (process.argv.includes("--browser-ui-only")) {
		const { verifyWorkstationBrowserUi } = await import(
			"./verify-workstation-browser-ui.mjs"
		);
		await verifyWorkstationBrowserUi({
			...options,
			scope,
			controls: options.controls.forNamespace(descriptor.namespaceId),
		});
	} else if (process.argv.includes("--workspace-view-v2-ipc-only")) {
		const { verifyWorkstationViewV2Ipc } = await import(
			"./verify-workstation-view-v2-ipc.mjs"
		);
		await verifyWorkstationViewV2Ipc({
			...options,
			scope,
			controls: options.controls.forNamespace(descriptor.namespaceId),
		});
	} else if (process.argv.includes("--clipboard-only")) {
		const { verifyWorkstationClipboardUi } = await import(
			"./verify-workstation-clipboard-ui.mjs"
		);
		await verifyWorkstationClipboardUi({
			...options,
			scope,
			controls: options.controls.forNamespace(descriptor.namespaceId),
		});
	} else await verifyWorkstationWheelUi({ ...options, scope });
	assert.deepEqual(getPage().errors, []);
}
