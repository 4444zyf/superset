import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { resolveDirectNamespace } from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

const execute = promisify(execFile);
export async function verifyWorkstationBrowserReadCliUi(options, { scope, url, marker, readView, workspace, terminalTab }) {
	const { until } = agentUiDriver(options);
	const captureEnabled = process.argv.includes("--browser-capture-cli");
	const controls = options.controls.forNamespace?.(scope.d.namespaceId) ?? options.controls;
	const home = controls.browserNamespaceHome();
	const root = fileURLToPath(new URL("../../../packages/cli/", import.meta.url));
	const cliHome = join(options.output, "browser-cli-config");
	mkdirSync(cliHome, { mode: 0o700 });
	const environment = { ...process.env, SUPERSET_HOME_DIR: cliHome };
	for (const key of ["SUPERSET_API_KEY", "SUPERSET_ORGANIZATION_ID", "SUPERSET_SANDBOX_WORKSPACE_ID"]) delete environment[key];
	const report = { mode: "Original source CLI dev runner, real Electron peer and owned namespace; bundled CLI unchanged", source: process.env.GITHUB_SHA, calls: [] };
	const save = () => writeFileSync(join(options.output, "browser-read-cli.json"), JSON.stringify(report, null, 2) + "\n");
	const ready = async () => until(async () => {
		const target = await resolveDirectNamespace(home);
		assert.equal(target.description.backendId, scope.d.backendId);
		assert.equal(target.description.namespaceId, scope.d.namespaceId);
		return target.description.capabilities.workstationBrowserReadBridgeV1 === true && (!captureEnabled || target.description.capabilities.workstationBrowserCaptureV1 === true);
	}, "authenticated browser read peer ready");
	async function run(command, flags = [], workspaceId = scope.w.workspaceId, succeeds = true) {
		const argv = ["../cli-framework/src/bin.ts", "dev", "browser", command, "--namespace", home, "--workspace", workspaceId, ...flags, "--json"];
		let result;
		try { result = { ...(await execute("bun", argv, { cwd: root, env: environment, maxBuffer: 1024 * 1024 })), code: 0 }; }
		catch (error) { result = { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
		report.calls.push({ command, flags, workspaceId, ...result }); save();
		if (succeeds) { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); }
		assert.notEqual(result.code, 0); return result;
	}
	async function capture(label, paneId) {
		const file = join(options.output, `cli-browser-${label}.png`);
		assert.equal(existsSync(file), false);
		const clipboardText = await options.readClipboardText(), clipboardImage = await options.readClipboardImage();
		assert.deepEqual(await run("screenshot", ["--pane", paneId, "--out", file]), { path: file });
		const png = readFileSync(file);
		assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
		const image = await options.inspectClipboardImage(png.toString("base64"));
		assert.ok(image.size.width > 100 && image.size.height > 100);
		assert.deepEqual(image.corner, [255, 255, 255, 255], "default browser canvas is opaque white in the exported PNG");
		assert.equal(await options.readClipboardText(), clipboardText);
		assert.deepEqual(await options.readClipboardImage(), clipboardImage);
		return { file, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), image, clipboardUnchanged: true };
	}
	await ready();
	const pane = workspace(await readView()).panes.find(p => p.kind === "browser");
	assert.ok(pane);
	const rows = await run("list");
	assert.deepEqual(rows.map(row => row.paneId), [pane.paneId]);
	assert.equal(rows[0].workspaceId, scope.w.workspaceId);
	assert.equal(rows[0].url, url);
	assert.equal(rows[0].title, "Owned browser home 中文 🙂");
	const consoleRows = await run("console", ["--pane", pane.paneId]);
	assert.ok(consoleRows.some(row => row.message.includes(marker)));
	assert.deepEqual(await run("console", ["--pane", pane.paneId, "--max-lines", "0"]), []);
	assert.deepEqual(await run("list", [], randomUUID()), []);
	const denied = await run("console", ["--pane", pane.paneId], randomUUID(), false);
	assert.match(denied.stderr, /Browser read failed or pane is no longer current/);
	if (captureEnabled) {
		report.initialCapture = await capture("initial", pane.paneId);
		const browserTab = workspace(await readView()).activePaneTabId;
		assert.ok(browserTab && terminalTab && browserTab !== terminalTab);
		await options.click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);
		await until(async () => workspace(await readView()).activePaneTabId === terminalTab, "terminal tab hides the browser pane");
		await options.screenshot("browser-cli-hidden-tab");
		report.hiddenCapture = await capture("hidden", pane.paneId);
		assert.equal(workspace(await readView()).activePaneTabId, terminalTab);
		await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
		await until(async () => workspace(await readView()).activePaneTabId === browserTab, "original browser tab selected after background capture");
		const file = join(options.output, "cli-browser-denied.png");
		const rejected = await run("screenshot", ["--pane", pane.paneId, "--out", file], randomUUID(), false);
		assert.match(rejected.stderr, /Browser screenshot failed or pane is no longer current/);
		assert.equal(existsSync(file), false);
		report.foreignCaptureRefused = true;
	}
	report.initial = { paneId: pane.paneId, rows, consoleRows }; save();
	return {
		async afterReopen(expectedUrl) {
			await ready();
			const reopened = await run("list");
			assert.deepEqual(reopened.map(row => row.paneId), [pane.paneId]);
			assert.equal(reopened[0].url, expectedUrl);
			const entries = await run("console", ["--pane", pane.paneId]);
			assert.ok(entries.some(row => row.message.includes(marker)));
			if (captureEnabled) report.reopenedCapture = await capture("reopened", pane.paneId);
			report.reopened = { rows: reopened, consoleRows: entries }; save();
		},
	};
}
