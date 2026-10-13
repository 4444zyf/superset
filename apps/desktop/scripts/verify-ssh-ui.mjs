import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenSshRuntime } from "../../../packages/direct-connection/src/ssh.ts";
import { createSshFixture } from "../../../packages/direct-connection/src/ssh-fixture.ts";
import { controlRemoteBackend } from "../../../packages/direct-install/src/lifecycle.ts";
import { ownedRestoreControls } from "./verify-restore-controls.mjs";

export async function verifySshUi({
	page,
	click,
	screenshot,
	resources,
	output,
	verifyRestore,
}) {
	assert.equal(process.platform, "darwin");
	assert.equal(process.env.GITHUB_ACTIONS, "true");
	const backendHome = join(homedir(), ".superset-direct");
	const systemRoot = "/Library/Application Support/SupersetDirect";
	assert.equal(existsSync(backendHome), false);
	assert.equal(existsSync(systemRoot), false);
	const sshDir = join(homedir(), ".ssh");
	const config = join(sshDir, "config");
	assert.equal(
		existsSync(config),
		false,
		"SSH UI verification needs a fresh runner config",
	);
	mkdirSync(sshDir, { recursive: true, mode: 0o700 });
	const fixture = await createSshFixture();
	const gitConfig = join(homedir(), ".gitconfig");
	const gitContents =
		"[user]\n name = Restore Fixture\n email = restore-fixture@example.invalid\n";
	const ownsGitConfig = !existsSync(gitConfig);
	if (ownsGitConfig)
		writeFileSync(gitConfig, gitContents, { mode: 0o600, flag: "wx" });
	const runtime = new OpenSshRuntime({ configFile: fixture.configFile });
	const keys = JSON.parse(
		readFileSync(join(resources, "direct-release-keys.json"), "utf8"),
	);
	const until = async (operation) => {
		for (let attempt = 0; attempt < 600; attempt++) {
			const value = await operation();
			if (value) return value;
			await delay(100);
		}
		throw new Error("SSH UI did not become ready");
	};
	const type = async (selector, text) => {
		await click(selector);
		await page.call("Input.insertText", { text });
	};
	try {
		writeFileSync(
			config,
			`Host SupersetPerfFixture\n  HostName 127.0.0.1\n  Port ${fixture.profile.port}\n  User ${fixture.profile.user}\n  IdentityFile "${fixture.profile.identityFile}"\n  UserKnownHostsFile "${join(fixture.root, "known_hosts")}"\n  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n`,
			{ mode: 0o600, flag: "wx" },
		);
		await click(
			'[data-slot=sidebar-content] button[aria-label="SSH machines"]',
		);
		await click(".ws-heading > button.primary");
		await type('input[name="name"]', "Performance Mac");
		await type('input[name="host"]', "SupersetPerfFixture");
		await click('.ws-drawer-form button[type="submit"]');
		await until(() =>
			page.evaluate("!document.querySelector('.ws-drawer-form')"),
		);
		await page.evaluate(`(() => {
			window.sshUiMeasurement = { started: performance.now(), phases: [] };
			const observer = new MutationObserver(() => {
				const current = window.sshUiMeasurement;
				if (document.querySelector('[data-slot=sidebar-content] button[aria-label="Workspaces"]')?.getAttribute('aria-current') === 'page' && current.workspaceReadyMs === undefined) current.workspaceReadyMs = performance.now() - current.started;
				const element = document.querySelector('.ws-setup-progress');
				if (element) { const current = window.sshUiMeasurement; const label = element.querySelector('p')?.textContent; if (current.phases.at(-1)?.label !== label) current.phases.push({ label, status: element.dataset.setupStatus, elapsedMs: performance.now() - current.started }); }
			});
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			window.sshUiObserver = observer; return true;
		})()`);
		await click(".ws-detail-actions button.primary");
		await until(() =>
			page.evaluate(
				"document.querySelector('.ws-setup-progress')?.dataset.setupStatus === 'running'",
			),
		);
		await screenshot("ssh-install-progress");
		await until(async () => {
			const state = await page.evaluate(
				"({ ready: document.querySelector('[data-slot=sidebar-content] button[aria-label=\"Workspaces\"]')?.getAttribute('aria-current') === 'page', status: document.querySelector('.ws-setup-progress')?.dataset.setupStatus, error: document.querySelector('.ws-error')?.textContent })",
			);
			if (state.status === "failed" || state.error)
				throw new Error(`SSH UI connection failed: ${state.error}`);
			return state.ready;
		});
		await screenshot("ssh-workspaces-ready");
		await click(
			'[data-slot=sidebar-content] button[aria-label="SSH machines"]',
		);
		await until(() =>
			page.evaluate(
				"document.querySelector('.ws-setup-progress')?.dataset.setupStatus === 'completed'",
			),
		);
		const measurement = await page.evaluate("window.sshUiMeasurement");
		assert.ok(
			measurement.phases.some((phase) => phase.label === "Uploading backend"),
		);
		assert.ok(
			measurement.phases.some(
				(phase) => phase.label === "Verifying and installing backend",
			),
		);
		assert.equal(measurement.phases.at(-1).status, "completed");
		const before = JSON.parse(
			readFileSync(join(backendHome, "state/endpoint.json"), "utf8"),
		);
		await screenshot("ssh-connected");
		await click(".ws-detail-actions button:last-child");
		await until(() =>
			page.evaluate(
				"document.querySelector('.ws-detail-actions button.primary')?.textContent.includes('Connect')",
			),
		);
		const reconnectStarted = performance.now();
		await click(".ws-detail-actions button.primary");
		await until(() =>
			page.evaluate(
				"document.querySelector('[data-slot=sidebar-content] button[aria-label=\"Workspaces\"]')?.getAttribute('aria-current') === 'page'",
			),
		);
		const reconnectMs = performance.now() - reconnectStarted;
		await click(
			'[data-slot=sidebar-content] button[aria-label="SSH machines"]',
		);
		await until(() =>
			page.evaluate(
				"document.querySelector('.ws-setup-progress')?.dataset.setupStatus === 'completed'",
			),
		);
		assert.equal(
			JSON.parse(readFileSync(join(backendHome, "state/endpoint.json"), "utf8"))
				.instanceId,
			before.instanceId,
		);
		await screenshot("ssh-reconnected");
		if (verifyRestore)
			await verifyRestore(ownedRestoreControls(backendHome, fixture));
		if (!verifyRestore) {
			await click(".ws-detail-actions button:last-child");
			await page.evaluate("window.sshUiObserver.disconnect(); true");
		}
		writeFileSync(
			join(output, "ssh-ui.json"),
			JSON.stringify(
				{
					source: process.env.GITHUB_SHA,
					arch: process.arch,
					realInput: true,
					firstFeedbackMs: measurement.phases[0]?.elapsedMs,
					firstInstallVisibleMs: measurement.workspaceReadyMs,
					reconnectMs,
					phases: measurement.phases,
					sameInstance: true,
				},
				null,
				2,
			),
		);
	} finally {
		try {
			if (existsSync(join(backendHome, "service-config.json")))
				await controlRemoteBackend({
					transport: {
						exec: (command, stdin) =>
							runtime.exec(fixture.profile, command, stdin),
						upload: (local, remote) =>
							runtime.upload(fixture.profile, local, remote),
					},
					trustedKeys: keys,
					action: "uninstall",
				});
		} finally {
			runtime.dispose();
			await fixture.close();
			rmSync(config, { force: true });
			if (ownsGitConfig) {
				assert.equal(readFileSync(gitConfig, "utf8"), gitContents);
				rmSync(gitConfig);
			}
		}
	}
}
