import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import {
	LOCAL_CONNECTION_ID,
	LocalBackend,
	type LocalBackendOptions,
} from "./local";

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

function fixture(
	setupOptions: {
		failSpawn?: boolean;
		realProxy?: boolean;
		deferReady?: boolean;
		importOwned?: LocalBackendOptions["importOwned"];
	} = {},
) {
	const dataDir = mkdtempSync(join(tmpdir(), "direct-local-"));
	directories.push(dataDir);
	let started = 0;
	let available = false;
	let spawnOptions: unknown;
	let socketPath: string | undefined;
	let proxyClosures = 0;
	let offlineStops = 0;
	let shutdowns = 0;
	let publishReady = () => {};
	let releaseReady!: () => void;
	let reportWaiting!: () => void;
	const ready = new Promise<void>((resolve) => {
		releaseReady = resolve;
	});
	const waiting = new Promise<void>((resolve) => {
		reportWaiting = resolve;
	});
	const backend = new LocalBackend({
		dataDir,
		execPath: process.execPath,
		supervisorPath: "/signed-app/direct-supervisor.js",
		hostServicePath: "/signed-app/direct-backend.js",
		migrationsFolder: "/signed-app/host-migrations",
		chatMigrationsFolder: "/signed-app/chat-migrations",
		uid: 1000,
		platform: "linux",
		architecture: "x64",
		user: "local-user",
		homeDir: "/home/local-user",
		attempts: 2,
		wait: async () => {
			if (setupOptions.deferReady) {
				reportWaiting();
				await ready;
			}
		},
		stopOwned: async () => {
			offlineStops++;
		},
		importOwned: setupOptions.importOwned,
		proxy: setupOptions.realProxy
			? undefined
			: async (path) => {
					expect(path).toBe(socketPath ?? "");
					return {
						url: "http://127.0.0.1:45679",
						close() {
							proxyClosures++;
						},
					};
				},
		spawn: (_command, _args, options) => {
			started++;
			spawnOptions = options;
			if (setupOptions.failSpawn)
				return {
					unref() {},
					once(_event: "error", callback: (error: Error) => void) {
						queueMicrotask(() => callback(new Error("ENOENT")));
					},
				};
			available = true;
			const config = JSON.parse(
				readFileSync(join(dataDir, "service-config.json"), "utf8"),
			);
			if (!socketPath) {
				socketPath = directBackendSocketPath({ ...config, uid: 1000 });
				mkdirSync(dirname(socketPath), { mode: 0o700 });
				directories.push(dirname(socketPath));
				const server = createServer((_request, response) =>
					response.end("owned backend"),
				);
				servers.push(server);
				server.listen(socketPath);
				chmodSync(socketPath, 0o600);
			}
			publishReady = () => {
				writeFileSync(
					join(dataDir, "state", "endpoint.json"),
					JSON.stringify({
						backendId: config.backendId,
						namespaceId: config.namespaceId,
						instanceId: "local-instance",
						serviceUid: 1000,
						port: 45678,
						runtimeMode: "direct",
						protocolVersion: 1,
						socketPath,
					}),
					{ mode: 0o600 },
				);
				releaseReady();
			};
			if (!setupOptions.deferReady) publishReady();
			return { unref() {} };
		},
		socketFetch: async (path, url, options) => {
			expect(path).toBe(socketPath ?? "");
			if (!available) throw new Error("not running");
			if (url.endsWith("/direct/shutdown")) {
				shutdowns++;
				const body = JSON.parse(String(options?.body));
				if (
					typeof body.ownerId !== "string" ||
					!/^[a-f0-9-]{36}$/i.test(body.ownerId) ||
					body.stopTerminals !== true
				)
					return Response.json(
						{ error: "Expected a maintenance owner UUID and stopTerminals" },
						{ status: 400 },
					);
				available = false;
				rmSync(join(dataDir, "state", "endpoint.json"));
				return Response.json({ status: "stopping" }, { status: 202 });
			}
			expect(url).toBe("/direct/describe");
			expect(new Headers(options?.headers).get("authorization")).toBe(
				`Bearer ${readFileSync(join(dataDir, "credentials", "host-secret"), "utf8").trim()}`,
			);
			return Response.json(
				JSON.parse(
					readFileSync(join(dataDir, "state", "endpoint.json"), "utf8"),
				),
			);
		},
	});
	return {
		backend,
		dataDir,
		get started() {
			return started;
		},
		get spawnOptions() {
			return spawnOptions;
		},
		get proxyClosures() {
			return proxyClosures;
		},
		waiting,
		publishReady: () => publishReady(),
		get offlineStops() {
			return offlineStops;
		},
		get shutdowns() {
			return shutdowns;
		},
	};
}

test("local backend owns detached runtime and disconnect leaves it running", async () => {
	const setup = fixture();
	const connection = await setup.backend.connect();
	expect(LOCAL_CONNECTION_ID).toBe("00000000-0000-4000-8000-000000000001");
	expect(setup.spawnOptions).toMatchObject({
		detached: true,
		stdio: "ignore",
		cwd: setup.dataDir,
		env: { ELECTRON_RUN_AS_NODE: "1" },
	});
	expect(connection.url).toBe("http://127.0.0.1:45679");
	connection.close();
	expect(setup.proxyClosures).toBe(1);
	expect((await setup.backend.connect()).descriptor.backendId).toBe(
		connection.descriptor.backendId,
	);
	expect(setup.started).toBe(1);
});

test("local identity and owner-only credentials survive client restarts", async () => {
	const setup = fixture();
	const first = await setup.backend.connect();
	const identity = JSON.parse(
		readFileSync(join(setup.dataDir, "identity.json"), "utf8"),
	);
	expect(identity.backendId).toBe(first.descriptor.backendId);
	expect(identity.namespaceId).toBe(first.descriptor.namespaceId);
	expect(setup.dataDir).not.toBe("/home/local-user/.superset-direct");
	expect((await setup.backend.test()).installed).toBe(true);
});

test("local credentials cannot be replaced by a symlink", async () => {
	const setup = fixture();
	await setup.backend.connect();
	const credential = join(setup.dataDir, "credentials", "host-secret");
	const other = join(setup.dataDir, "other-secret");
	writeFileSync(other, "f".repeat(64));
	rmSync(credential);
	symlinkSync(other, credential);
	await expect(setup.backend.connect()).rejects.toThrow("owner-only");
});

test("the local backend refuses privileged and unsupported runtimes", async () => {
	const options = {
		dataDir: "/tmp/local",
		execPath: "/app/electron",
		supervisorPath: "/app/direct-supervisor.js",
		hostServicePath: "/app/direct-backend.js",
		migrationsFolder: "/app/migrations",
		chatMigrationsFolder: "/app/chat-migrations",
	};
	await expect(new LocalBackend({ ...options, uid: 0 }).test()).rejects.toThrow(
		"ordinary OS user",
	);
	await expect(
		new LocalBackend({ ...options, uid: 1000, platform: "win32" }).test(),
	).rejects.toThrow("Unix PTY");
});

test("explicit local stop keeps data disabled until explicit start", async () => {
	const setup = fixture();
	const first = await setup.backend.connect();
	await setup.backend.stop();
	await expect(setup.backend.connect()).rejects.toThrow("stopped");
	expect(readFileSync(join(setup.dataDir, "identity.json"), "utf8")).toContain(
		first.descriptor.backendId,
	);
	const restarted = await setup.backend.start();
	expect(restarted.descriptor.backendId).toBe(first.descriptor.backendId);
	expect(setup.started).toBe(2);
});

test("an asynchronous spawn error is reported without an uncaught process event", async () => {
	const setup = fixture({ failSpawn: true });
	await expect(setup.backend.connect()).rejects.toThrow(
		"Could not launch the local backend",
	);
	expect(setup.started).toBe(1);
});

test("two callers share backend startup and own independent proxies", async () => {
	const setup = fixture({ realProxy: true });
	const [first, second] = await Promise.all([
		setup.backend.connect(),
		setup.backend.connect(),
	]);
	try {
		expect(first).not.toBe(second);
		expect(first.url).not.toBe(second.url);
		first.close();
		expect(
			await (
				await fetch(second.url, {
					headers: { Authorization: "Bearer private-secret" },
				})
			).text(),
		).toBe("owned backend");
		expect(setup.started).toBe(1);
	} finally {
		first.close();
		second.close();
	}
});

test("stop waits for a pending startup and stops its newly published instance", async () => {
	const setup = fixture({ deferReady: true });
	const connecting = setup.backend.connect();
	await setup.waiting;
	let stopped = false;
	const stopping = setup.backend.stop().then(() => {
		stopped = true;
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(stopped).toBe(false);
	expect(setup.offlineStops).toBe(0);
	setup.publishReady();
	const connection = await connecting;
	await stopping;
	connection.close();
	expect(setup.shutdowns).toBe(1);
	await expect(setup.backend.connect()).rejects.toThrow("stopped");
});

test("an offline import lock prevents Start from reenabling the namespace", async () => {
	const setup = fixture();
	await setup.backend.stop();
	writeFileSync(
		join(setup.dataDir, "state", "legacy-import.lock"),
		"offline import",
		{ mode: 0o600 },
	);
	await expect(setup.backend.start()).rejects.toThrow("import");
	expect(
		readFileSync(join(setup.dataDir, "state", "disabled"), "utf8"),
	).toContain("stop");
	expect(setup.started).toBe(0);
});

test("local import runs only while stopped and serializes with explicit Start", async () => {
	let releaseImport!: () => void;
	let notifyImport!: () => void;
	const gate = new Promise<void>((resolve) => {
		releaseImport = resolve;
	});
	const startedImport = new Promise<void>((resolve) => {
		notifyImport = resolve;
	});
	const setup = fixture({
		importOwned: async (configPath, sourceDirectory) => {
			expect(sourceDirectory).toBe("/old/host/organization");
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			notifyImport();
			await gate;
			return {
				sourceNamespace: "organization",
				targetNamespace: config.namespaceId,
				projects: 1,
				workspaces: 2,
				terminals: 0,
				chats: 0,
				journalPath: join(setup.dataDir, "state", "import.json"),
			};
		},
	});
	await expect(
		setup.backend.importLocalData("/old/host/organization"),
	).rejects.toThrow("Stop");
	await setup.backend.stop();
	const importing = setup.backend.importLocalData("/old/host/organization");
	await startedImport;
	const starting = setup.backend.start();
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(setup.started).toBe(0);
	releaseImport();
	expect((await importing).projects).toBe(1);
	const connection = await starting;
	connection.close();
	expect(setup.started).toBe(1);
});
