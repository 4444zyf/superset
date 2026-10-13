import assert from "node:assert/strict";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSshFixture } from "../../../packages/direct-connection/src/ssh-fixture.ts";
import { ownedRestoreControls } from "./verify-restore-controls.mjs";
import { LocalBackend } from "../../../packages/direct-connection/src/local.ts";

export async function sourceSshFixture(root) {
	assert.equal(process.platform, "linux");
	const fixture = await createSshFixture({ isolateHome: true });
	const config = join(homedir(), ".ssh/config");
	const original = existsSync(config) ? readFileSync(config, "utf8") : "";
	const alias = `WorkspaceRestore${fixture.profile.port}`;
	const block = `\n# BEGIN ${alias}\nHost ${alias}\n  HostName 127.0.0.1\n  Port ${fixture.profile.port}\n  User ${fixture.profile.user}\n  IdentityFile "${fixture.profile.identityFile}"\n  UserKnownHostsFile "${join(fixture.root, "known_hosts")}"\n  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n# END ${alias}\n`;
	mkdirSync(join(homedir(), ".ssh"), { recursive: true, mode: 0o700 });
	writeFileSync(config, original + block, { mode: 0o600 });
	writeFileSync(
		join(fixture.root, "gitconfig"),
		"[user]\n name = Restore Fixture\n email = restore-fixture@example.invalid\n",
		{ mode: 0o600 },
	);
	const backend = new LocalBackend({
		dataDir: join(fixture.homeDir, ".superset-direct"),
		execPath: process.env.BRAND_VERIFY_EXECUTABLE,
		supervisorPath: join(root, "apps/desktop/dist/main/direct-supervisor.js"),
		hostServicePath: join(root, "apps/desktop/dist/main/direct-backend.js"),
		migrationsFolder: join(root, "apps/desktop/dist/resources/host-migrations"),
		chatMigrationsFolder: join(
			root,
			"apps/desktop/dist/resources/chat-migrations",
		),
		environment: {
			GIT_CONFIG_GLOBAL: join(fixture.root, "gitconfig"),
			PATH: process.env.PATH,
			LANG: "en_US.UTF-8",
			SUPERSET_PTY_DAEMON_SCRIPT_PATH: join(
				root,
				"packages/pty-daemon/dist/pty-daemon.js",
			),
		},
	});
	try {
		const connection = await backend.connect();
		return {
			alias,
			fixture,
			controls: ownedRestoreControls(
				join(fixture.homeDir, ".superset-direct"),
				fixture,
			),
			async close() {
				await backend.stop();
				connection.close();
				const current = readFileSync(config, "utf8");
				assert.ok(current.includes(block));
				const next = current.replace(block, "");
				if (!next) rmSync(config);
				else writeFileSync(config, next, { mode: 0o600 });
				await fixture.close();
			},
		};
	} catch (error) {
		writeFileSync(config, original, { mode: 0o600 });
		await fixture.close();
		throw error;
	}
}
