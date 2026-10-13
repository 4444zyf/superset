import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { DirectConnectionManager } from "../../../packages/direct-connection/src/manager";
import { ConnectionRegistry } from "../../../packages/direct-connection/src/registry";
import { OpenSshRuntime } from "../../../packages/direct-connection/src/ssh";
import { createSshFixture } from "../../../packages/direct-connection/src/ssh-fixture";
import {
	createReleaseArchive,
	extractReleaseArchive,
} from "../../../packages/direct-install/src/archive";
import { installRemoteBackend } from "../../../packages/direct-install/src/install";
import { controlRemoteBackend } from "../../../packages/direct-install/src/lifecycle";
import { verifyReleaseBundle } from "../../../packages/direct-install/src/release";

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
let trustedKeys = JSON.parse(
	readFileSync(join(resources, "direct-release-keys.json"), "utf8"),
);
const variant =
	process.argv.find((value) => value.startsWith("--variant="))?.slice(10) ??
	"v2-gzip6";
assert.ok(
	["v1-independent", "v1-shared", "v2-gzip1", "v2-gzip6"].includes(variant),
);
let releaseRoot = join(resources, "direct-backend", `darwin-${process.arch}`);
let experimentRoot: string | undefined;
if (variant !== "v2-gzip6") {
	const original = verifyReleaseBundle(releaseRoot, trustedKeys);
	assert.ok(original.manifest.archive);
	experimentRoot = mkdtempSync(join(tmpdir(), "ssh-benchmark-release-"));
	const expanded = join(experimentRoot, "expanded");
	mkdirSync(expanded);
	await extractReleaseArchive(
		join(releaseRoot, "backend.tar.gz"),
		expanded,
		original,
	);
	const pair = generateKeyPairSync("ed25519");
	trustedKeys = {
		benchmark: pair.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	};
	const manifest = {
		...original.manifest,
		formatVersion: variant.startsWith("v1-") ? 1 : 2,
		archive: undefined as typeof original.manifest.archive,
	};
	if (variant === "v2-gzip1") {
		releaseRoot = join(experimentRoot, "packed");
		mkdirSync(releaseRoot);
		const archive = join(releaseRoot, "backend.tar.gz");
		await createReleaseArchive(expanded, archive, manifest.files, 1);
		const bytes = readFileSync(archive);
		manifest.archive = {
			...original.manifest.archive,
			size: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	} else releaseRoot = expanded;
	const bytes = Buffer.from(JSON.stringify(manifest));
	writeFileSync(join(releaseRoot, "release-manifest.json"), bytes);
	writeFileSync(
		join(releaseRoot, "release-signature.json"),
		JSON.stringify({
			keyId: "benchmark",
			signature: sign(null, bytes, pair.privateKey).toString("base64"),
		}),
	);
}
const release = verifyReleaseBundle(releaseRoot, trustedKeys);
const fixture = await createSshFixture();
const runtime = new OpenSshRuntime({
	configFile: fixture.configFile,
	reuseConnections: variant !== "v1-independent",
});
const registry = new ConnectionRegistry(new Database(":memory:"));
registry.save(fixture.profile);
let installs = 0;
let batches = 0;
let uploadedFiles = 0;
const phases: { phase: string; elapsedMs: number }[] = [];
let taskStarted = 0;
let uploadMs = 0;
const manager = new DirectConnectionManager({
	registry,
	runtime,
	onStatus: (_id, status) =>
		phases.push({
			phase: status.state,
			elapsedMs: performance.now() - taskStarted,
		}),
	install: async (_profile, transport, probe) => {
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
					const start = performance.now();
					await uploadFiles(files);
					uploadMs += performance.now() - start;
				},
			},
			releaseRoot,
			trustedKeys,
			probe:
				probe.groupname && probe.macOS
					? {
							target: `darwin-${process.arch}` as "darwin-arm64" | "darwin-x64",
							uid: probe.uid,
							username: probe.user,
							groupname: probe.groupname,
							userHome: probe.homeDir,
							macOS: probe.macOS,
						}
					: undefined,
			onPhase: (phase) =>
				phases.push({ phase, elapsedMs: performance.now() - taskStarted }),
			...(stage ? { password: "preview-runner-nopasswd" } : {}),
		});
	},
});
try {
	const probe = await manager.test(fixture.profile.id);
	assert.equal(probe.installed, false);
	assert.equal(installs, 0);
	runtime.cancel(fixture.profile.id);
	taskStarted = performance.now();
	const connectionsBeforeInstall = fixture.stats().authenticatedConnections;
	const first = await manager.connect(fixture.profile.id);
	const firstInstallMs = performance.now() - taskStarted;
	const installConnections =
		fixture.stats().authenticatedConnections - connectionsBeforeInstall;
	if (variant !== "v1-independent") assert.equal(installConnections, 1);
	assert.equal(manager.getStatus(fixture.profile.id).state, "ready");
	assert.equal(installs, 1);
	assert.equal(batches, 1);
	if (release.manifest.archive) assert.equal(uploadedFiles, 3);
	else assert.ok(uploadedFiles > 20);
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
	const reconnectMs: number[] = [];
	const workspaceReadyMs: number[] = [];
	const reuseMs: number[] = [];
	for (let sample = 0; sample < 30; sample++) {
		manager.disconnect(fixture.profile.id);
		const start = performance.now();
		const lease = await manager.connect(fixture.profile.id);
		reconnectMs.push(performance.now() - start);
		assert.equal(lease.instanceId, first.instanceId);
		await Promise.all([
			manager.invoke(fixture.profile.id, {
				path: "project.list",
				type: "query",
			}),
			manager.invoke(fixture.profile.id, {
				path: "workspace.list",
				type: "query",
			}),
		]);
		workspaceReadyMs.push(performance.now() - start);
		const reused = performance.now();
		assert.deepEqual(await manager.connect(fixture.profile.id), lease);
		reuseMs.push(performance.now() - reused);
	}
	assert.equal(installs, 1);
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
		variant,
		firstInstallMs,
		installConnections,
		uploadMs,
		fileCount: release.manifest.files.length,
		expandedBytes: release.manifest.files.reduce(
			(sum, file) => sum + file.size,
			0,
		),
		archiveBytes: release.manifest.archive?.size ?? null,
		phases: phases.slice(0, 24),
		reconnectMs,
		workspaceReadyMs,
		reuseMs,
	};
	mkdirSync(resolve(import.meta.dirname, "../release"), { recursive: true });
	writeFileSync(
		join(
			resolve(import.meta.dirname, "../release"),
			`SSH-INSTALL-${stage ? "stage-" : ""}${process.arch}${variant === "v2-gzip6" ? "" : `-${variant}`}${process.env.BENCH_ITERATION ? `-${process.env.BENCH_ITERATION}` : ""}.json`,
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
		if (experimentRoot)
			rmSync(experimentRoot, { recursive: true, force: true });
	}
}
