import { randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import { getRequestListener, serve } from "@hono/node-server";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import Database from "better-sqlite3";
import { createApp } from "../app";
import { configureSupervisor, getSupervisor } from "../daemon";
import { LocalGitCredentialProvider } from "../providers/git";
import { PskHostAuthProvider } from "../providers/host-auth";
import { applyLoginShellEnvToProcess } from "../runtime/login-shell-env";
import { startTerminalBaseEnvResolution } from "../terminal/env";
import { configureDirectAgentEnvironment } from "./agent-environment";
import {
	type DirectEndpoint,
	loadDirectConfig,
	publishDirectEndpoint,
	readDirectSecret,
} from "./config";
import { configureManagedWorkspaceHome } from "./managed-paths";
import { DirectOperationStore } from "./operations";
import { acquireDirectProcessLock } from "./process-lock";
import { prepareDirectRuntime } from "./startup";
import { listenDirectSocket } from "./unix-listener";

export async function stopOwnedBackend(configPath: string): Promise<void> {
	const uid = process.getuid?.();
	if (uid === undefined || uid === 0)
		throw new Error("Owned backend cleanup requires the ordinary service UID");
	const configStat = lstatSync(configPath);
	if (
		!configStat.isFile() ||
		configStat.uid !== uid ||
		(configStat.mode & 0o077) !== 0
	)
		throw new Error(
			"Owned cleanup requires a private configuration owned by the service user",
		);
	const config = loadDirectConfig(configPath);
	const homeStat = lstatSync(config.homeDir);
	if (
		!homeStat.isDirectory() ||
		homeStat.uid !== uid ||
		(homeStat.mode & 0o077) !== 0
	)
		throw new Error(
			"Owned cleanup requires a private backend home owned by the service user",
		);
	readDirectSecret(config.secretFile);
	process.env.SUPERSET_HOME_DIR = config.homeDir;
	delete process.env.SUPERSET_PTY_DAEMON_SOCKET;
	configureSupervisor({ autoUpdate: false, preserveExistingSessions: true });
	await getSupervisor().stopExisting(config.namespaceId);
}

export async function startDirectBackend(
	configPath: string,
	options: { onStopped?: () => void } = {},
) {
	const config = loadDirectConfig(configPath);
	const secret = readDirectSecret(config.secretFile);
	const release = acquireDirectProcessLock(
		join(config.homeDir, "state", "backend.lock"),
	);
	const hostDir = join(config.homeDir, "host", config.namespaceId);
	const serviceUid = process.getuid?.() ?? 0;
	const identity = {
		backendId: config.backendId,
		namespaceId: config.namespaceId,
		instanceId: randomUUID(),
		serviceUid,
		socketPath: directBackendSocketPath({ ...config, uid: serviceUid }),
	};
	let endpointPath: string | null = null;
	let result: ReturnType<typeof createApp> | null = null;
	let operationDb: Database.Database | null = null;
	let stopBackend: (() => Promise<void>) | undefined;
	const transportServers: Server[] = [];
	const transportSockets = new Set<Socket>();
	const trackServer = (server: Server) => {
		transportServers.push(server);
		server.on("connection", (socket) => {
			transportSockets.add(socket);
			socket.once("close", () => transportSockets.delete(socket));
		});
		return server;
	};
	const closeTransports = async () => {
		for (const socket of transportSockets) socket.destroy();
		await Promise.all(
			transportServers
				.filter((server) => server.listening)
				.map(
					(server) =>
						new Promise<void>((resolve, reject) =>
							server.close((error) => (error ? reject(error) : resolve())),
						),
				),
		);
	};
	try {
		mkdirSync(hostDir, { recursive: true, mode: 0o700 });
		process.env.SUPERSET_HOME_DIR = config.homeDir;
		process.env.ORGANIZATION_ID = config.namespaceId;
		process.env.HOST_MANIFEST_DIR = hostDir;
		delete process.env.SUPERSET_PTY_DAEMON_SOCKET;
		if (config.chatMigrationsFolder)
			process.env.SUPERSET_CHAT_V3_MIGRATIONS = config.chatMigrationsFolder;
		configureManagedWorkspaceHome(config.homeDir);
		configureDirectAgentEnvironment(config.homeDir);
		configureSupervisor({ autoUpdate: false, preserveExistingSessions: true });
		startTerminalBaseEnvResolution();
		void applyLoginShellEnvToProcess();
		operationDb = new Database(join(hostDir, "operations.db"));
		operationDb.pragma("journal_mode = WAL");
		operationDb.pragma("synchronous = FULL");
		const directOperations = new DirectOperationStore(
			operationDb,
			identity.instanceId,
		);
		await prepareDirectRuntime(directOperations.maintenance(), () =>
			getSupervisor().ensure(config.namespaceId),
		);
		result = createApp({
			config: {
				runtimeMode: "direct",
				direct: identity,
				directOperations,
				requestDirectShutdown: (stopTerminals) => {
					if (stopTerminals)
						writeFileSync(
							join(config.homeDir, "state", "disabled"),
							"explicit-lifecycle-stop\n",
							{ mode: 0o600 },
						);
					setImmediate(() => {
						void (async () => {
							if (stopTerminals) await getSupervisor().stop(config.namespaceId);
							await stopBackend?.();
							options.onStopped?.();
						})().catch((error) => {
							console.error("[direct-backend] explicit shutdown failed", error);
						});
					});
				},
				organizationId: config.namespaceId,
				dbPath: join(hostDir, "host.db"),
				migrationsFolder: config.migrationsFolder,
				allowedOrigins: config.allowedOrigins,
			},
			providers: {
				hostAuth: new PskHostAuthProvider(secret),
				credentials: new LocalGitCredentialProvider(),
			},
		});
		const service = result;
		const controlServer = trackServer(
			createServer(getRequestListener(service.app.fetch)),
		);
		service.injectWebSocket(controlServer);
		await listenDirectSocket(controlServer, { ...config, uid: serviceUid });
		let announce!: (endpoint: DirectEndpoint) => void;
		let fail!: (error: Error) => void;
		const listening = new Promise<DirectEndpoint>((resolve, reject) => {
			announce = resolve;
			fail = reject;
		});
		const server = serve(
			{ fetch: service.app.fetch, port: 0, hostname: "127.0.0.1" },
			(info) => {
				const endpoint: DirectEndpoint = {
					...identity,
					port: info.port,
					runtimeMode: "direct",
					protocolVersion: 1,
				};
				try {
					endpointPath = publishDirectEndpoint(config.homeDir, endpoint);
					announce(endpoint);
				} catch (error) {
					fail(error as Error);
				}
			},
		);
		trackServer(server as Server);
		server.once("error", fail);
		service.injectWebSocket(server);
		const endpoint = await listening;
		let stopped = false;
		stopBackend = async () => {
			if (stopped) return;
			stopped = true;
			try {
				await closeTransports();
				await service.dispose();
			} finally {
				if (endpointPath) {
					try {
						if (
							JSON.parse(readFileSync(endpointPath, "utf8")).instanceId ===
							identity.instanceId
						)
							unlinkSync(endpointPath);
					} catch {}
				}
				release();
				operationDb?.close();
			}
		};
		return { endpoint, stop: stopBackend };
	} catch (error) {
		await closeTransports();
		await result?.dispose();
		operationDb?.close();
		release();
		throw error;
	}
}
