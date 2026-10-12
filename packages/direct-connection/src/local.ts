import { spawn as spawnProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readlinkSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { runLocalImportProcess } from "./local-import-process";
import {
	assertPrivateSocket,
	privateSocketFetch,
	startPrivateSocketProxy,
} from "./local-socket";
import type { EndpointDescriptor, RemoteProbe } from "./manager";
import { uuidPattern } from "./registry";

export const LOCAL_CONNECTION_ID = "00000000-0000-4000-8000-000000000001";

export interface LocalConnection {
	descriptor: EndpointDescriptor;
	secret: string;
	url: string;
	close(): void;
}

export interface LocalLegacyImportResult {
	sourceNamespace: string;
	targetNamespace: string;
	projects: number;
	workspaces: number;
	terminals: number;
	chats: number;
	journalPath: string;
	warnings?: string[];
}

export interface LocalBackendOptions {
	namespaceIdentity?: { backendId: string; namespaceId: string };
	dataDir: string;
	execPath: string;
	supervisorPath: string;
	hostServicePath: string;
	migrationsFolder: string;
	chatMigrationsFolder: string;
	environment?: NodeJS.ProcessEnv;
	uid?: number;
	platform?: NodeJS.Platform;
	architecture?: string;
	user?: string;
	homeDir?: string;
	attempts?: number;
	wait?: (milliseconds: number) => Promise<void>;
	socketFetch?: typeof privateSocketFetch;
	proxy?: typeof startPrivateSocketProxy;
	spawn?: (
		command: string,
		args: string[],
		options: {
			detached: true;
			stdio: "ignore";
			cwd: string;
			env: NodeJS.ProcessEnv;
		},
	) => {
		unref(): void;
		once?(event: "error", callback: (error: Error) => void): unknown;
	};
	stopOwned?: (configPath: string) => Promise<void>;
	importOwned?: (
		configPath: string,
		sourceDirectory: string,
	) => Promise<LocalLegacyImportResult>;
}

interface LocalIdentity {
	backendId: string;
	namespaceId: string;
}
interface LocalConfig extends LocalIdentity {
	homeDir: string;
	secretFile: string;
	hostServicePath: string;
	migrationsFolder: string;
	chatMigrationsFolder: string;
	allowedOrigins: string[];
	installationMode?: "local";
}

interface AuthenticatedLocalBackend {
	descriptor: EndpointDescriptor & { socketPath: string };
	secret: string;
}

function privateDirectory(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o077) !== 0 ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error("Local backend directories must be owner-only directories");
}

function privateRead(path: string): string | null {
	let fd: number;
	try {
		fd = openSync(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error("Local backend data must be owner-only regular files", {
			cause: error,
		});
	}
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.size > 1024 * 1024 ||
			(stat.mode & 0o077) !== 0 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("Local backend data must be owner-only regular files");
		return readFileSync(fd, "utf8");
	} finally {
		closeSync(fd);
	}
}

function createPrivate(path: string, value: string): void {
	try {
		writeFileSync(path, value, { flag: "wx", mode: 0o600 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

export class LocalBackend {
	describeNamespace(): { backendId: string; namespaceId: string } {
		if (this.uid < 1)
			throw new Error("A local namespace requires an ordinary OS user");
		const { config } = this.prepare();
		return { backendId: config.backendId, namespaceId: config.namespaceId };
	}
	private pending: Promise<AuthenticatedLocalBackend> | undefined;
	private lifecycle: Promise<void> = Promise.resolve();
	private readonly uid: number;
	private readonly platform: NodeJS.Platform;
	constructor(private readonly options: LocalBackendOptions) {
		this.uid = options.uid ?? process.getuid?.() ?? -1;
		this.platform = options.platform ?? process.platform;
		for (const path of [
			options.dataDir,
			options.execPath,
			options.supervisorPath,
			options.hostServicePath,
			options.migrationsFolder,
			options.chatMigrationsFolder,
		]) {
			if (
				!isAbsolute(path) ||
				Array.from(path).some((character) => character.charCodeAt(0) < 32)
			)
				throw new Error("Local backend paths must be absolute paths");
		}
	}
	async test(): Promise<RemoteProbe> {
		if (!Number.isInteger(this.uid) || this.uid < 1)
			throw new Error(
				"Run Superset as an ordinary OS user to start the local backend",
			);
		if (!["darwin", "linux"].includes(this.platform))
			throw new Error(
				"The local backend requires Unix PTY and socket support; use an SSH Mac backend on this platform",
			);
		return {
			platform: this.platform,
			architecture: this.options.architecture ?? process.arch,
			uid: this.uid,
			user: this.options.user ?? userInfo().username,
			homeDir: this.options.homeDir ?? homedir(),
			installed:
				privateRead(join(this.options.dataDir, "service-config.json")) !== null,
		};
	}
	connect(): Promise<LocalConnection> {
		if (!this.pending) {
			const pending = this.serialize(() => this.connectOwned()).finally(() => {
				if (this.pending === pending) this.pending = undefined;
			});
			this.pending = pending;
		}
		return this.pending.then((backend) => this.connectProxy(backend));
	}
	private serialize<T>(action: () => Promise<T>): Promise<T> {
		const result = this.lifecycle.then(action);
		this.lifecycle = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	async control(action: "start" | "stop"): Promise<{ status: "completed" }> {
		if (action === "start") (await this.start()).close();
		else if (action === "stop") await this.stop();
		else throw new Error("Unsupported local backend action");
		return { status: "completed" };
	}
	start(): Promise<LocalConnection> {
		return this.serialize(async () => {
			await this.test();
			if (
				privateRead(
					join(this.options.dataDir, "state", "legacy-import.lock"),
				) !== null
			)
				throw new Error(
					"An offline data import must finish before starting the local backend",
				);
			const { config, secret } = this.prepare();
			const running = await this.inspect(config, secret);
			if (!running) {
				await this.waitUntil(
					() => !this.supervisorRunning(),
					"The previous local supervisor is still stopping",
				);
				this.replaceConfig({
					...config,
					installationMode: "local",
					hostServicePath: this.options.hostServicePath,
					migrationsFolder: this.options.migrationsFolder,
					chatMigrationsFolder: this.options.chatMigrationsFolder,
				});
			}
			try {
				unlinkSync(join(this.options.dataDir, "state", "disabled"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			return this.connectProxy(await this.connectOwned());
		});
	}
	stop(): Promise<void> {
		return this.serialize(async () => {
			await this.test();
			const { config, secret } = this.prepare();
			createPrivate(
				join(this.options.dataDir, "state", "disabled"),
				"explicit-local-stop\n",
			);
			const connection = await this.inspect(config, secret);
			if (connection) {
				const response = await (this.options.socketFetch ?? privateSocketFetch)(
					connection.descriptor.socketPath,
					"/direct/shutdown",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${secret}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							ownerId: randomUUID(),
							stopTerminals: true,
						}),
						redirect: "error",
						signal: AbortSignal.timeout(2000),
					},
				);
				if (!response.ok) throw new Error("Could not stop the local backend");
				await this.waitUntil(
					() =>
						privateRead(
							join(this.options.dataDir, "state", "endpoint.json"),
						) === null,
					"The local backend is still stopping",
				);
			} else if (this.options.stopOwned)
				await this.options.stopOwned(
					join(this.options.dataDir, "service-config.json"),
				);
			else await this.stopOffline(config);
		});
	}
	importLocalData(sourceDirectory: string): Promise<LocalLegacyImportResult> {
		return this.serialize(async () => {
			await this.test();
			if (!isAbsolute(sourceDirectory) || /[\0\r\n]/.test(sourceDirectory))
				throw new Error("Select an absolute legacy namespace directory");
			const { config } = this.prepare();
			if (
				privateRead(join(this.options.dataDir, "state", "disabled")) === null ||
				privateRead(join(this.options.dataDir, "state", "endpoint.json")) !==
					null
			)
				throw new Error("Stop the local backend before importing data");
			const configPath = join(this.options.dataDir, "service-config.json");
			const result = this.options.importOwned
				? await this.options.importOwned(configPath, sourceDirectory)
				: await this.importOffline(config, sourceDirectory);
			if (
				!result ||
				result.targetNamespace !== config.namespaceId ||
				typeof result.sourceNamespace !== "string" ||
				!result.sourceNamespace ||
				typeof result.journalPath !== "string" ||
				!result.journalPath.startsWith(`${this.options.dataDir}/state/`) ||
				[
					result.projects,
					result.workspaces,
					result.terminals,
					result.chats,
				].some((count) => !Number.isSafeInteger(count) || count < 0) ||
				(result.warnings !== undefined &&
					(!Array.isArray(result.warnings) ||
						result.warnings.length > 10 ||
						result.warnings.some(
							(warning) =>
								typeof warning !== "string" ||
								!warning ||
								warning.length > 512 ||
								/[\0\r]/.test(warning),
						)))
			)
				throw new Error(
					"The local importer returned an invalid result; inspect its journal before retrying",
				);
			return result;
		});
	}
	private async importOffline(
		config: LocalConfig,
		sourceDirectory: string,
	): Promise<LocalLegacyImportResult> {
		const stdout = await runLocalImportProcess({
			executable: this.options.execPath,
			args: [
				config.hostServicePath,
				"--import-local-data",
				sourceDirectory,
				"--config",
				join(this.options.dataDir, "service-config.json"),
			],
			cwd: this.options.dataDir,
			environment: this.environment(),
		});
		try {
			return JSON.parse(stdout) as LocalLegacyImportResult;
		} catch {
			throw new Error("The local importer returned an invalid result");
		}
	}
	private replaceConfig(config: LocalConfig): void {
		const target = join(this.options.dataDir, "service-config.json");
		privateRead(target);
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, JSON.stringify(config), {
				flag: "wx",
				mode: 0o600,
			});
			renameSync(temporary, target);
		} finally {
			try {
				unlinkSync(temporary);
			} catch {}
		}
	}
	private supervisorRunning(): boolean {
		const path = join(this.options.dataDir, "state", "supervisor.lock");
		try {
			const stat = lstatSync(path);
			if (
				!stat.isSymbolicLink() ||
				(process.getuid && stat.uid !== process.getuid())
			)
				throw new Error("Invalid local supervisor lock");
			const owner = /^superset-direct-lock-(\d+)-[a-f0-9-]{36}$/.exec(
				readlinkSync(path),
			);
			if (!owner) throw new Error("Invalid local supervisor owner");
			try {
				process.kill(Number(owner[1]), 0);
				return true;
			} catch (error) {
				return (error as NodeJS.ErrnoException).code !== "ESRCH";
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}
	private async waitUntil(
		ready: () => boolean,
		failure: string,
	): Promise<void> {
		for (let attempt = 0; attempt < (this.options.attempts ?? 50); attempt++) {
			if (ready()) return;
			if (attempt + 1 < (this.options.attempts ?? 50)) await this.wait();
		}
		throw new Error(failure);
	}
	private wait(): Promise<void> {
		return (
			this.options.wait ??
			((milliseconds) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)))
		)(100);
	}
	private environment(): NodeJS.ProcessEnv {
		const environment: NodeJS.ProcessEnv = {
			...this.options.environment,
			ELECTRON_RUN_AS_NODE: "1",
		};
		for (const key of [
			"NODE_OPTIONS",
			"NODE_PATH",
			"HOST_PARENT_PID",
			"AUTH_TOKEN",
			"ORGANIZATION_ID",
			"SUPERSET_HOSTED_PLUGINS",
			"SUPERSET_RUN_DIR",
		])
			delete environment[key];
		return environment;
	}
	private stopOffline(config: LocalConfig): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = spawnProcess(
				this.options.execPath,
				[
					config.hostServicePath,
					"--stop-owned",
					"--config",
					join(this.options.dataDir, "service-config.json"),
				],
				{ stdio: "ignore", cwd: this.options.dataDir, env: this.environment() },
			);
			const timeout = setTimeout(() => {
				child.kill("SIGTERM");
				reject(new Error("The local terminal cleanup did not complete"));
			}, 5000);
			const clean = () => clearTimeout(timeout);
			child.once("error", (error) => {
				clean();
				reject(error);
			});
			child.once("exit", (code) => {
				clean();
				if (code === 0) resolve();
				else reject(new Error("The local terminal cleanup failed"));
			});
		});
	}
	private prepare(): { config: LocalConfig; secret: string } {
		const root = this.options.dataDir;
		for (const path of [root, join(root, "state"), join(root, "credentials")])
			privateDirectory(path);
		createPrivate(
			join(root, "identity.json"),
			JSON.stringify(
				this.options.namespaceIdentity ?? {
					backendId: randomUUID(),
					namespaceId: randomUUID(),
				},
			),
		);
		const identity = JSON.parse(
			privateRead(join(root, "identity.json")) ?? "null",
		) as LocalIdentity | null;
		if (
			!identity ||
			!uuidPattern.test(identity.backendId) ||
			!uuidPattern.test(identity.namespaceId)
		)
			throw new Error("Invalid local backend identity");
		if (
			this.options.namespaceIdentity &&
			(identity.backendId !== this.options.namespaceIdentity.backendId ||
				identity.namespaceId !== this.options.namespaceIdentity.namespaceId)
		)
			throw new Error("Local namespace identity does not match its catalog");
		const secretFile = join(root, "credentials", "host-secret");
		createPrivate(secretFile, randomBytes(32).toString("hex"));
		const secret = privateRead(secretFile)?.trim();
		if (!secret || !/^[a-f0-9]{64}$/.test(secret))
			throw new Error("Invalid local backend credentials");
		createPrivate(
			join(root, "service-config.json"),
			JSON.stringify({
				...identity,
				homeDir: root,
				secretFile,
				hostServicePath: this.options.hostServicePath,
				migrationsFolder: this.options.migrationsFolder,
				chatMigrationsFolder: this.options.chatMigrationsFolder,
				allowedOrigins: [],
				installationMode: "local",
			}),
		);
		const config = JSON.parse(
			privateRead(join(root, "service-config.json")) ?? "null",
		) as LocalConfig | null;
		if (
			!config ||
			config.backendId !== identity.backendId ||
			config.namespaceId !== identity.namespaceId ||
			config.homeDir !== root ||
			config.secretFile !== secretFile ||
			!isAbsolute(config.hostServicePath) ||
			!isAbsolute(config.migrationsFolder) ||
			!isAbsolute(config.chatMigrationsFolder) ||
			(config.installationMode !== undefined &&
				config.installationMode !== "local")
		)
			throw new Error(
				"Local backend configuration does not belong to this profile",
			);
		return { config, secret };
	}
	private async inspect(
		config: LocalConfig,
		secret: string,
	): Promise<AuthenticatedLocalBackend | null> {
		const raw = privateRead(
			join(this.options.dataDir, "state", "endpoint.json"),
		);
		if (!raw) return null;
		const descriptor = JSON.parse(raw) as EndpointDescriptor & {
			socketPath: string;
		};
		const expectedSocket = directBackendSocketPath({
			...config,
			uid: this.uid,
		});
		if (
			descriptor.backendId !== config.backendId ||
			descriptor.namespaceId !== config.namespaceId ||
			descriptor.serviceUid !== this.uid ||
			descriptor.runtimeMode !== "direct" ||
			descriptor.protocolVersion !== 1 ||
			!Number.isInteger(descriptor.port) ||
			descriptor.port < 1 ||
			descriptor.port > 65535 ||
			typeof descriptor.instanceId !== "string" ||
			!descriptor.instanceId ||
			descriptor.instanceId.length > 128 ||
			descriptor.socketPath !== expectedSocket
		)
			throw new Error("Local backend identity mismatch");
		try {
			assertPrivateSocket(descriptor.socketPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		let response: Response;
		try {
			response = await (this.options.socketFetch ?? privateSocketFetch)(
				descriptor.socketPath,
				"/direct/describe",
				{
					headers: { Authorization: `Bearer ${secret}` },
					redirect: "error",
					signal: AbortSignal.timeout(2000),
				},
			);
		} catch {
			return null;
		}
		if (!response.ok) throw new Error("Local backend authentication failed");
		const health = (await response.json()) as EndpointDescriptor & {
			socketPath: string;
		};
		if (
			[
				"backendId",
				"namespaceId",
				"serviceUid",
				"runtimeMode",
				"protocolVersion",
				"instanceId",
				"socketPath",
			].some(
				(field) =>
					health[field as keyof typeof descriptor] !==
					descriptor[field as keyof typeof descriptor],
			)
		)
			throw new Error("Local backend identity mismatch");
		return { descriptor, secret };
	}
	private async connectProxy(
		backend: AuthenticatedLocalBackend,
	): Promise<LocalConnection> {
		const proxy = await (this.options.proxy ?? startPrivateSocketProxy)(
			backend.descriptor.socketPath,
		);
		return { ...backend, url: proxy.url, close: () => proxy.close() };
	}
	private async connectOwned(): Promise<AuthenticatedLocalBackend> {
		await this.test();
		const { config, secret } = this.prepare();
		if (privateRead(join(this.options.dataDir, "state", "disabled")) !== null)
			throw new Error(
				"The local backend is stopped; start it explicitly before connecting",
			);
		const existing = await this.inspect(config, secret);
		if (existing) return existing;
		if (
			config.hostServicePath !== this.options.hostServicePath ||
			config.migrationsFolder !== this.options.migrationsFolder ||
			config.chatMigrationsFolder !== this.options.chatMigrationsFolder
		)
			throw new Error(
				"The local runtime changed; stop the previous local backend before replacing its runtime",
			);
		const environment = this.environment();
		const child = (this.options.spawn ?? spawnProcess)(
			this.options.execPath,
			[
				this.options.supervisorPath,
				"--config",
				join(this.options.dataDir, "service-config.json"),
			],
			{
				detached: true,
				stdio: "ignore",
				cwd: this.options.dataDir,
				env: environment,
			},
		);
		child.unref();
		let spawnError: Error | undefined;
		child.once?.("error", (error) => {
			spawnError = error;
		});
		for (let attempt = 0; attempt < (this.options.attempts ?? 50); attempt++) {
			if (spawnError)
				throw new Error("Could not launch the local backend", {
					cause: spawnError,
				});
			const connection = await this.inspect(config, secret);
			if (connection) return connection;
			if (attempt + 1 < (this.options.attempts ?? 50)) await this.wait();
		}
		throw new Error(
			"The local backend did not become ready; verify this app's native runtime and migration resources",
		);
	}
}
