import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationAgentSettingsUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	requestClose,
	controls,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read) => {
		for (let i = 0; i < 200; i++) {
			const value = await read();
			if (value) return value;
			await delay(50);
		}
		await screenshot("agent-settings-failure");
		throw new Error("Agent settings UI condition failed");
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const target=snapshot.targets.find(t=>t.connectionId===d.connectionId);return {connectionId:d.connectionId,workspaceId:target.workspaces.find(w=>w.tabId===target.activeTabId).workspaceId};})()`,
	);
	const query = (path, input) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)})throw new Error('Unexpected agent target');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const original = await controls.verifyWorktreeLocation(
		workspace.worktreePath,
	);
	await query("settings.agentConfigs.list", undefined);
	const fixture = await controls.prepareTerminalPreset(workspace.worktreePath);
	await click("[data-workstation-presets] > button:last-of-type");
	await until(() =>
		evaluate(
			`Boolean([...document.querySelectorAll('[data-workstation-presets] button')].find(e=>e.textContent.trim()===${JSON.stringify(fixture.label)}))`,
		),
	);
	const fixtureConfig = (
		await query("settings.agentConfigs.list", undefined)
	).find((agent) => agent.label === fixture.label);
	assert.ok(fixtureConfig);
	const snapshot = () =>
		query("settings.agentConfigs.getWithRevisionV1", { id: fixtureConfig.id });
	const root = "[data-workstation-agent-settings]";
	const label = `${root} input[aria-label="Label"]`;
	const field = (suffix) =>
		`${root} input[id=${JSON.stringify(fixtureConfig.id + "-" + suffix)}]`;
	const value = (selector) =>
		evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`);
	const scrollTo = async (selector) => {
		for (let i = 0; i < 30; i++) {
			const view = await evaluate(
				`(()=>{const dialog=document.querySelector('${root}'),selector=${JSON.stringify(selector)},e=selector.startsWith('text:')?[...(dialog?.querySelectorAll('button')??[])].find(e=>e.textContent.trim()===selector.slice(5)):document.querySelector(selector);if(!e||!dialog)return null;const r=e.getBoundingClientRect(),d=dialog.getBoundingClientRect();return {top:r.top,bottom:r.bottom,clipTop:Math.max(d.top,0)+12,clipBottom:Math.min(d.bottom,innerHeight)-12,x:d.right-40,y:d.y+d.height/2};})()`,
			);
			if (view && view.top >= view.clipTop && view.bottom <= view.clipBottom)
				return;
			if (!view) {
				await delay(50);
				continue;
			}
			await getPage().call("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: view.x,
				y: view.y,
				deltaX: 0,
				deltaY:
					view.bottom > view.clipBottom
						? Math.min(450, view.bottom - view.clipBottom + 80)
						: -Math.min(450, view.clipTop - view.top + 80),
			});
			await delay(50);
		}
		throw new Error(`Agent field not scrollable: ${selector}`);
	};
	const replace = async (selector, text) => {
		await scrollTo(selector);
		await click(selector);
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key: "a",
				code: "KeyA",
				windowsVirtualKeyCode: 65,
				modifiers: process.platform === "darwin" ? 4 : 2,
				commands: ["selectAll"],
			});
		await getPage().call("Input.insertText", { text });
		await until(async () => (await value(selector)) === text);
	};
	const blur = async () => {
		await scrollTo(`${root} h2`);
		await click(`${root} h2`);
	};
	const saved = async (predicate) =>
		until(async () => {
			const current = await snapshot();
			const ready = await evaluate(
				`Boolean(document.querySelector('${root}')?.textContent.includes('Saved'))&&!document.querySelector('${root} fieldset:disabled input[aria-label="Label"]')`,
			);
			return predicate(current.config) && ready ? current : null;
		});
	await click('button[aria-label="Agent settings"]');
	await until(() => evaluate(`Boolean(document.querySelector('${root}'))`));
	await click(`text:${fixture.label}`);
	await until(async () => (await value(field("command")))?.includes("/bin/sh"));
	await screenshot("agent-settings-original-fields-before-edit");
	const editedLabel = "Configured fixture agent";
	await replace(label, editedLabel);
	await blur();
	await saved((config) => config.label === editedLabel);
	const command = String.raw`REMIX_EDITOR_TEST='中文 space 🙂' /bin/sh -c 'printf "%s\n" "$REMIX_EDITOR_TEST" >> editor-runs.txt; printf "%s\n" "$PWD" >> editor-cwd.txt; printf "editor probe done\n"'`;
	await replace(field("command"), command);
	await blur();
	await saved(
		(config) =>
			config.env.REMIX_EDITOR_TEST === "中文 space 🙂" &&
			config.command === "/bin/sh",
	);
	await replace(field("prompt-args"), "--prompt");
	await blur();
	await saved((config) => config.promptArgs.join(" ") === "--prompt");
	await replace(field("resume-args"), "resume --continue");
	await blur();
	await saved((config) => config.resumeArgs.join(" ") === "resume --continue");
	await replace(field("fork-args"), "fork {sessionId}");
	await blur();
	await saved((config) => config.forkArgs.join(" ") === "fork {sessionId}");
	const mode = `${root} button[aria-label="Prompt transport: stdin"]`;
	await scrollTo(mode);
	await click(mode);
	const configured = await saved(
		(config) => config.promptTransport === "stdin",
	);
	const countPath = join(workspace.worktreePath, "editor-runs.txt");
	assert.equal(existsSync(countPath), false);
	await screenshot("agent-settings-original-prompt-resume-fork-and-mode-saved");
	const localLabel = "Keep unsent local label";
	await replace(label, localLabel);
	await controls.changeFixtureAgentConfig(fixtureConfig.id);
	await blur();
	await until(() =>
		evaluate(
			`document.querySelector('${root}')?.textContent.includes('This configuration changed. Reload before saving.')`,
		),
	);
	assert.equal(await value(label), localLabel);
	const external = await snapshot();
	assert.equal(external.config.command, "/external/agent-not-executable");
	assert.equal(external.config.label, editedLabel);
	await screenshot("agent-settings-conflict-keeps-original-input");
	await requestClose("window");
	await until(() =>
		evaluate(
			"document.querySelector('[role=alertdialog]')?.textContent.includes('Unsaved changes')",
		),
	);
	await click("text:Save All");
	await until(() =>
		evaluate(
			"document.querySelector('[role=alertdialog]')?.textContent.includes('This configuration changed. Reload before saving.')",
		),
	);
	assert.equal((await snapshot()).revision, external.revision);
	await screenshot("agent-settings-window-save-all-conflict-blocks-close");
	await click("text:Cancel");
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	assert.equal(await value(label), localLabel);
	await scrollTo("text:Reload");
	await click("text:Reload");
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=alertdialog]'))"),
	);
	await click("text:Cancel");
	await until(() => evaluate("!document.querySelector('[role=alertdialog]')"));
	assert.equal(await value(label), localLabel);
	await click("text:Reload");
	await until(() =>
		evaluate("Boolean(document.querySelector('[role=alertdialog]'))"),
	);
	await click("[role=alertdialog] button:last-child");
	await until(
		async () =>
			(await value(field("command"))) === "/external/agent-not-executable",
	);
	assert.equal((await snapshot()).revision, external.revision);
	assert.equal(await value(label), editedLabel);
	await screenshot("agent-settings-explicit-reload-without-writing");
	await replace(field("command"), command);
	await blur();
	await saved((config) => config.command === "/bin/sh");
	const finalLabel = "Final fixture agent";
	await replace(label, finalLabel);
	await blur();
	const final = await saved((config) => config.label === finalLabel);
	assert.deepEqual(final.config.promptArgs, ["--prompt"]);
	assert.deepEqual(final.config.resumeArgs, ["resume", "--continue"]);
	assert.deepEqual(final.config.forkArgs, ["fork", "{sessionId}"]);
	assert.equal(final.config.promptTransport, "stdin");
	assert.equal(final.config.env.REMIX_EDITOR_TEST, "中文 space 🙂");
	assert.equal(existsSync(countPath), false);
	await scrollTo(`${root} [data-slot=dialog-close]`);
	await click(`${root} [data-slot=dialog-close]`);
	await until(() => evaluate(`!document.querySelector('${root}')`));
	await click(`text:${finalLabel}`);
	await until(
		() =>
			existsSync(countPath) &&
			readFileSync(countPath, "utf8") === "中文 space 🙂\n",
	);
	assert.equal(
		readFileSync(join(workspace.worktreePath, "editor-cwd.txt"), "utf8"),
		workspace.worktreePath + "\n",
	);
	const panes = () =>
		evaluate(
			`(async()=>{const {snapshot}=await window.directWorkstation.getWorkspaceView();return snapshot.targets.find(t=>t.connectionId===${JSON.stringify(scope.connectionId)}).workspaces.find(w=>w.workspaceId===${JSON.stringify(scope.workspaceId)}).panes;})()`,
		);
	const pane = await until(async () =>
		(await panes()).find((p) => p.label === finalLabel),
	);
	const spawned = await controls.inspectPresetTerminal(pane.resourceId);
	assert.equal(spawned.cwd, workspace.worktreePath);
	await screenshot("agent-settings-explicitly-launched-edited-command-on-ssh");
	await closeReopen();
	await until(() =>
		evaluate(
			`(async()=>{const r=await window.directWorkstation.getWorkspaceRestore();return r.status==='ready'&&r.descriptor?.connectionId===${JSON.stringify(scope.connectionId)};})()`,
		),
	);
	await until(() =>
		evaluate(
			`Boolean([...document.querySelectorAll('[data-workstation-presets] button')].find(e=>e.textContent.trim()===${JSON.stringify(finalLabel)}))`,
		),
	);
	assert.equal((await snapshot()).revision, final.revision);
	assert.deepEqual((await snapshot()).config, final.config);
	assert.equal(readFileSync(countPath, "utf8"), "中文 space 🙂\n");
	const reopened = await controls.inspectPresetTerminal(pane.resourceId);
	for (const key of ["id", "executionId", "pid", "cwd"])
		assert.equal(reopened[key], spawned[key]);
	assert.deepEqual(
		await controls.verifyWorktreeLocation(workspace.worktreePath),
		original,
	);
	assert.deepEqual(getPage().errors, []);
	await screenshot("agent-settings-reopened-without-running-again");
	writeFileSync(
		join(output, "workstation-agent-settings-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				workspaceId: scope.workspaceId,
				configId: fixtureConfig.id,
				configuredRevision: configured.revision,
				externalRevision: external.revision,
				finalRevision: final.revision,
				originalTerminals: original.terminals,
				spawned: {
					id: reopened.id,
					executionId: reopened.executionId,
					pid: reopened.pid,
					cwd: reopened.cwd,
				},
				originalFormFields: true,
				compareAndSwapChecked: true,
				windowCloseFailureChecked: true,
				explicitReloadWithoutWrite: true,
				explicitCommandRuns: 1,
				noAutomaticRelaunch: true,
				vendorAgentVerified: false,
				macOSVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
