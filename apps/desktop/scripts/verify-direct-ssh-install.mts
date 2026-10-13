import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { DirectConnectionManager } from "../../../packages/direct-connection/src/manager";
import { ConnectionRegistry } from "../../../packages/direct-connection/src/registry";
import { OpenSshRuntime } from "../../../packages/direct-connection/src/ssh";
import { createSshFixture } from "../../../packages/direct-connection/src/ssh-fixture";
import { installRemoteBackend } from "../../../packages/direct-install/src/install";
import { controlRemoteBackend } from "../../../packages/direct-install/src/lifecycle";

assert.equal(process.platform, "darwin");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const stage = process.argv.includes("--stage");
assert.ok(
	process.versions.electron,
	"Use the Electron runtime for both early and packaged acceptance",
);
const resources = resolve(process.argv[2] ?? "");
const home = join(homedir(), ".superset-direct");
const systemRoot = "/Library/Application Support/SupersetDirect";
assert.equal(
	existsSync(home),
	false,
	"Acceptance requires an unused runner backend home",
);
assert.equal(
	existsSync(systemRoot),
	false,
	"Acceptance requires an unused runner system runtime",
);
const trustedKeys = JSON.parse(
	readFileSync(join(resources, "direct-release-keys.json"), "utf8"),
);
const fixture = await createSshFixture();
const runtime = new OpenSshRuntime({ configFile: fixture.configFile });
const registry = new ConnectionRegistry(new Database(":memory:"));
registry.save(fixture.profile);
let installs = 0;
let batches = 0;
let uploadedFiles = 0;
const manager = new DirectConnectionManager({
	registry,
	runtime,
	install: async (_profile, transport) => {
		installs++;
		assert.ok(
			transport.uploadFiles,
			"Desktop transport must expose batch upload",
		);
		const uploadFiles = transport.uploadFiles.bind(transport);
		await installRemoteBackend({
			transport: {
				...transport,
				uploadFiles: async (files) => {
					batches++;
					uploadedFiles += files.length;
					await uploadFiles(files);
				},
			},
			releaseRoot: join(resources, "direct-backend", `darwin-${process.arch}`),
			trustedKeys,
			...(stage ? { password: "preview-runner-nopasswd" } : {}),
		});
	},
});
try {
	const probe = await manager.test(fixture.profile.id);
	assert.equal(probe.installed, false);
	assert.equal(installs, 0);
	const first = await manager.connect(fixture.profile.id);
	assert.equal(manager.getStatus(fixture.profile.id).state, "ready");
	assert.equal(installs, 1);
	assert.equal(batches, 1);
	assert.ok(uploadedFiles > 20);
	const before = (await manager.invoke(fixture.profile.id, {
		path: "direct.describe",
		type: "query",
	})) as {
		instanceId: string;
		backendId: string;
		namespaceId: string;
		version: string;
	};
	assert.equal(before.instanceId, first.instanceId);
	manager.disconnect(fixture.profile.id);
	assert.equal((await manager.test(fixture.profile.id)).installed, true);
	const second = await manager.connect(fixture.profile.id);
	assert.equal(second.backendId, first.backendId);
	assert.equal(second.instanceId, first.instanceId);
	assert.equal(installs, 1);
	const after = (await manager.invoke(fixture.profile.id, {
		path: "direct.describe",
		type: "query",
	})) as typeof before;
	assert.equal(after.instanceId, before.instanceId);
	manager.dispose();
	const reopened = new DirectConnectionManager({
		registry,
		runtime: new OpenSshRuntime({ configFile: fixture.configFile }),
		install: async () => {
			throw new Error(
				"Reopening a client must not reinstall the running backend",
			);
		},
	});
	try {
		const lease = await reopened.connect(fixture.profile.id);
		assert.equal(lease.instanceId, first.instanceId);
		assert.equal(reopened.getStatus(fixture.profile.id).state, "ready");
	} finally {
		reopened.dispose();
	}
	const result = {
		source: process.env.GITHUB_SHA,
		arch: process.arch,
		version: before.version,
		packagedElectron: process.versions.electron ?? null,
		sshProbe: "pass",
		sftpBatch: "pass",
		uploadedFiles,
		sudoInstall: "pass",
		launchDaemon: "pass",
		authenticatedRpc: "pass",
		reconnectSameInstance: "pass",
		reopenClientSameInstance: "pass",
		installs,
		batches,
	};
	mkdirSync(resolve(import.meta.dirname, "../release"), { recursive: true });
	writeFileSync(
		join(
			resolve(import.meta.dirname, "../release"),
			`SSH-INSTALL-${stage ? "stage-" : ""}${process.arch}.json`,
		),
		`${JSON.stringify(result, null, 2)}\n`,
	);
	console.log(JSON.stringify(result));
} catch (error) {
	for (const name of ["service.log", "service-error.log"]) {
		const path = join(home, "logs", name);
		if (existsSync(path))
			console.error(readFileSync(path, "utf8").slice(-8192));
	}
	throw error;
} finally {
	manager.dispose();
	registry.close();
	const cleanupRuntime = new OpenSshRuntime({ configFile: fixture.configFile });
	try {
		if (existsSync(join(home, "service-config.json"))) {
			await controlRemoteBackend({
				transport: {
					exec: (command, stdin) =>
						cleanupRuntime.exec(fixture.profile, command, stdin),
					upload: (local, remote) =>
						cleanupRuntime.upload(fixture.profile, local, remote),
				},
				trustedKeys,
				action: "uninstall",
			});
		}
	} finally {
		cleanupRuntime.dispose();
		await fixture.close();
		const label = `io.superset.direct.backend.${process.getuid?.()}`;
		const plist = `/Library/LaunchDaemons/${label}.plist`;
		if (existsSync(plist)) {
			try {
				execFileSync(
					"/usr/bin/sudo",
					["-n", "/bin/launchctl", "bootout", `system/${label}`],
					{ stdio: "ignore" },
				);
			} catch {}
			execFileSync("/usr/bin/sudo", ["-n", "/bin/rm", "-f", plist]);
		}
		execFileSync("/usr/bin/sudo", ["-n", "/bin/rm", "-rf", systemRoot]);
		rmSync(home, { recursive: true, force: true });
	}
}
