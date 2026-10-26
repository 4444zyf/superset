import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { resolveDirectNamespace } from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

const execute = promisify(execFile);
export async function verifyWorkstationBrowserReadCliUi(options, { scope, url, marker, readView, workspace }) {
	const { until } = agentUiDriver(options);
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
		return target.description.capabilities.workstationBrowserReadBridgeV1 === true;
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
	report.initial = { paneId: pane.paneId, rows, consoleRows }; save();
	return {
		async afterReopen(expectedUrl) {
			await ready();
			const reopened = await run("list");
			assert.deepEqual(reopened.map(row => row.paneId), [pane.paneId]);
			assert.equal(reopened[0].url, expectedUrl);
			const entries = await run("console", ["--pane", pane.paneId]);
			assert.ok(entries.some(row => row.message.includes(marker)));
			report.reopened = { rows: reopened, consoleRows: entries }; save();
		},
	};
}
