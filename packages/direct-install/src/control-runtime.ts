import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readlinkSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { readPrivateBackendFile } from "./health";
import { acquireInstallerLock } from "./installer-lock";
import { assertSafeRestart, type MaintenanceStatus } from "./lifecycle";
import { pruneManagedBackups } from "./user-maintenance";

export { maintainBackendLogs } from "./user-maintenance";

export const SYSTEM_ROOT = "/Library/Application Support/SupersetDirect";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-[a-f0-9]{24}$/;
export interface ServiceConfig {
	backendId: string;
	namespaceId: string;
	homeDir: string;
	secretFile: string;
	migrationsFolder: string;
	chatMigrationsFolder?: string;
	hostServicePath: string;
	allowedOrigins: string[];
	installationMode?: "local" | "managed";
}
export interface DatabaseBackup {
	database: string;
	backupPath: string;
	absent?: boolean;
}
export interface ActivationJournal {
	formatVersion: 1;
	transactionId: string;
	phase:
		| "preparing"
		| "quiescing"
		| "backed-up"
		| "verifying"
		| "committing"
		| "committed"
		| "rolling-back"
		| "rollback-verifying"
		| "rollback-committing"
		| "rolled-back"
		| "canceled";
	oldConfig: ServiceConfig;
	candidateConfig: ServiceConfig;
	oldInstanceId: string;
	oldVersion: string;
	candidateVersion: string;
	candidateReleaseId: string;
	backups: DatabaseBackup[];
	error: string | null;
}
export interface ActivationDriver {
	writeJournal(journal: ActivationJournal): void;
	assertHostStopped(): void;
	backup(): Promise<DatabaseBackup[]>;
	switchConfig(config: ServiceConfig): void;
	restore(): Promise<void>;
	verify(): Promise<void>;
	endDrain(): Promise<void>;
	stopCurrent(): Promise<void>;
	prepareQuiescence(): Promise<boolean>;
	verifyQuiescent(): Promise<void>;
	cancelPreparation(): void;
}
export type ActivationPhase = "before-start" | "after-start";
export async function advanceActivation(
	journal: ActivationJournal,
	phase: ActivationPhase,
	driver: ActivationDriver,
): Promise<void> {
	const transition = (next: ActivationJournal["phase"]) => {
		journal.phase = next;
		driver.writeJournal(journal);
	};
	if (journal.phase === "preparing") {
		if (phase === "before-start") {
			driver.assertHostStopped();
			driver.cancelPreparation();
			transition("canceled");
			return;
		}
		transition((await driver.prepareQuiescence()) ? "quiescing" : "canceled");
	}
	if (phase === "before-start") {
		if (journal.phase === "quiescing") {
			driver.assertHostStopped();
			try {
				journal.backups = await driver.backup();
				transition("backed-up");
			} catch (error) {
				journal.error = String(error);
				driver.switchConfig(journal.oldConfig);
				transition("rollback-verifying");
				return;
			}
		}
		if (journal.phase === "backed-up") {
			driver.switchConfig(journal.candidateConfig);
			transition("verifying");
		}
		if (journal.phase === "rolling-back") {
			driver.assertHostStopped();
			await driver.restore();
			driver.switchConfig(journal.oldConfig);
			transition("rollback-verifying");
		}
		return;
	}
	if (journal.phase === "quiescing") {
		await driver.verifyQuiescent();
		await driver.stopCurrent();
		return;
	}
	let verified = false;
	if (journal.phase === "verifying") {
		try {
			await driver.verify();
		} catch (error) {
			journal.error = String(error);
			await driver.stopCurrent();
			transition("rolling-back");
			return;
		}
		verified = true;
		transition("committing");
	}
	if (journal.phase === "committing") {
		if (!verified) await driver.verify();
		await driver.endDrain();
		transition("committed");
	}
	if (journal.phase === "rollback-verifying") {
		await driver.verify();
		transition("rollback-committing");
	}
	if (journal.phase === "rollback-committing") {
		await driver.endDrain();
		transition("rolled-back");
	}
}

export function assertServiceUser(): number {
	const uid = process.getuid?.();
	if (uid === undefined || uid === 0)
		throw new Error("User data operations require the ordinary service UID");
	return uid;
}
export function atomicPrivateJson(path: string, value: unknown): void {
	const temporary = `${path}.${randomUUID()}.partial`;
	const fd = openSync(temporary, "wx", 0o600);
	try {
		writeFileSync(fd, JSON.stringify(value));
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(temporary, path);
	syncDirectory(dirname(path));
}
function syncDirectory(path: string): void {
	const directory = openSync(path, "r");
	try {
		fsyncSync(directory);
	} finally {
		closeSync(directory);
	}
}
export function readServiceConfig(
	configPath: string,
	expectedHome = join(process.env.HOME ?? "", ".superset-direct"),
): ServiceConfig {
	assertServiceUser();
	const config = JSON.parse(
		readPrivateBackendFile(configPath, 65536),
	) as ServiceConfig;
	validateServiceConfig(config, expectedHome);
	if (configPath !== join(expectedHome, "service-config.json"))
		throw new Error("Unexpected backend config path");
	return config;
}
export function releaseRootFor(config: ServiceConfig): string {
	const prefix = `${SYSTEM_ROOT}/runtime/`;
	const suffix = "/lib/host-service-direct.js";
	if (
		!config.hostServicePath.startsWith(prefix) ||
		!config.hostServicePath.endsWith(suffix)
	)
		throw new Error("Invalid immutable release path");
	const root = config.hostServicePath.slice(0, -suffix.length);
	if (!RELEASE.test(root.slice(prefix.length)))
		throw new Error("Invalid immutable release identity");
	return root;
}
export function validateServiceConfig(
	config: ServiceConfig,
	expectedHome: string,
): void {
	if (
		!UUID.test(config.backendId) ||
		!UUID.test(config.namespaceId) ||
		config.homeDir !== expectedHome ||
		config.secretFile !== join(expectedHome, "credentials/host-secret") ||
		!Array.isArray(config.allowedOrigins) ||
		config.allowedOrigins.some((origin) => typeof origin !== "string")
	)
		throw new Error("Invalid backend config identity");
	const root = releaseRootFor(config);
	if (
		config.migrationsFolder !== join(root, "share/migrations") ||
		(config.chatMigrationsFolder !== undefined &&
			config.chatMigrationsFolder !== join(root, "lib/chat-migrations"))
	)
		throw new Error("Invalid backend migration path");
}
export function assertBackendStopped(config: ServiceConfig): void {
	const lock = join(config.homeDir, "state/backend.lock");
	if (!existsSync(lock) && !isSymlink(lock)) return;
	const marker = /^superset-direct-lock-(\d+)-[a-f0-9-]{36}$/.exec(
		readlinkSync(lock),
	);
	if (!marker) throw new Error("Invalid backend process lock");
	const pid = Number(marker[1]);
	if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647)
		throw new Error("Invalid backend lock PID");
	try {
		process.kill(pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
		throw error;
	}
	throw new Error(
		"The previous backend has not stopped; data must remain untouched",
	);
}
function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

interface Endpoint {
	backendId: string;
	namespaceId: string;
	instanceId: string;
	serviceUid: number;
	runtimeMode: string;
	protocolVersion: number;
	socketPath: string;
}
export async function requestBackendSocket<T>(
	socketPath: string,
	path: string,
	secret: string,
	body?: unknown,
): Promise<T> {
	return await new Promise<T>((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const request = httpRequest(
			{
				socketPath,
				path: `/direct/${path}`,
				method: body === undefined ? "GET" : "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": "application/json",
					...(payload === undefined
						? {}
						: { "Content-Length": Buffer.byteLength(payload) }),
				},
			},
			(response) => {
				if (
					!response.statusCode ||
					response.statusCode < 200 ||
					response.statusCode >= 300
				) {
					response.resume();
					reject(
						new Error(`Backend ${path} rejected (${response.statusCode})`),
					);
					return;
				}
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk) => {
					bytes += chunk.length;
					if (bytes > 65536) {
						request.destroy(
							new Error("Backend response exceeds the control limit"),
						);
						return;
					}
					chunks.push(Buffer.from(chunk));
				});
				response.on("error", reject);
				response.on("end", () => {
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		request.setTimeout(2000, () =>
			request.destroy(new Error("Backend control request timed out")),
		);
		request.on("error", reject);
		request.end(payload);
	});
}
export async function backendRequest<T>(
	config: ServiceConfig,
	path: string,
	body?: unknown,
): Promise<T> {
	const uid = assertServiceUser();
	const endpoint = JSON.parse(
		readPrivateBackendFile(join(config.homeDir, "state/endpoint.json"), 4096),
	) as Endpoint;
	if (
		endpoint.backendId !== config.backendId ||
		endpoint.namespaceId !== config.namespaceId ||
		endpoint.serviceUid !== uid ||
		endpoint.runtimeMode !== "direct" ||
		endpoint.protocolVersion !== 1 ||
		!UUID.test(endpoint.instanceId) ||
		endpoint.socketPath !==
			directBackendSocketPath({
				homeDir: config.homeDir,
				backendId: config.backendId,
				namespaceId: config.namespaceId,
				uid,
			})
	)
		throw new Error("Backend endpoint identity mismatch");
	for (const directory of [
		config.homeDir,
		join(config.homeDir, "state"),
		dirname(endpoint.socketPath),
	]) {
		const stat = lstatSync(directory);
		if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0)
			throw new Error("Backend socket parent is not private");
	}
	const socket = lstatSync(endpoint.socketPath);
	if (!socket.isSocket() || socket.uid !== uid || (socket.mode & 0o077) !== 0)
		throw new Error("Backend control socket is not private");
	const secret = readPrivateBackendFile(config.secretFile, 128).trim();
	if (!/^[a-f0-9]{64}$/.test(secret))
		throw new Error("Invalid backend credential");
	const result = await requestBackendSocket<T>(
		endpoint.socketPath,
		path,
		secret,
		body,
	);
	if (path === "describe") {
		const description = result as Endpoint;
		if (
			description.backendId !== endpoint.backendId ||
			description.namespaceId !== endpoint.namespaceId ||
			description.instanceId !== endpoint.instanceId ||
			description.serviceUid !== uid ||
			description.runtimeMode !== "direct" ||
			description.protocolVersion !== 1
		)
			throw new Error("Authenticated backend identity mismatch");
	}
	return result;
}
interface SqliteDatabase {
	backup(path: string): Promise<unknown>;
	close(): void;
	prepare(sql: string): { run(...params: unknown[]): unknown };
}
type SqliteConstructor = new (
	path: string,
	options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;
export function loadSqlite(config: ServiceConfig): SqliteConstructor {
	return createRequire(join(releaseRootFor(config), "lib/direct-installer.js"))(
		"better-sqlite3",
	) as SqliteConstructor;
}
export function clearOfflineMaintenance(
	config: ServiceConfig,
	ownerId: string,
): void {
	assertBackendStopped(config);
	const path = databasePath(config, "operations.db");
	if (!existsSync(path)) return;
	const Database = loadSqlite(config);
	const db = new Database(path, { fileMustExist: true });
	try {
		db.prepare("BEGIN IMMEDIATE").run();
		db.prepare(
			"UPDATE direct_freeze SET frozen = 0 WHERE id = 1 AND EXISTS (SELECT 1 FROM direct_maintenance WHERE id = 1 AND owner_id = ?)",
		).run(ownerId);
		db.prepare(
			"UPDATE direct_maintenance SET mode = 'active', owner_id = NULL WHERE id = 1 AND owner_id = ?",
		).run(ownerId);
		db.prepare("COMMIT").run();
	} finally {
		db.close();
	}
}
function databasePath(config: ServiceConfig, database: string): string {
	if (!["host.db", "chat.db", "operations.db"].includes(database))
		throw new Error("Invalid backup database");
	return join(config.homeDir, "host", config.namespaceId, database);
}
async function backupDatabases(
	journal: ActivationJournal,
): Promise<DatabaseBackup[]> {
	const root = join(
		journal.oldConfig.homeDir,
		"state/backups",
		journal.transactionId,
	);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	atomicPrivateJson(join(root, "snapshot.json"), {
		formatVersion: 1,
		transactionId: journal.transactionId,
		phase: "building",
		createdAt: Date.now(),
	});
	const Database = loadSqlite(journal.oldConfig);
	const backups: DatabaseBackup[] = [];
	for (const database of ["host.db", "chat.db", "operations.db"]) {
		const source = databasePath(journal.oldConfig, database);
		const backupPath = join(root, database);
		if (!existsSync(source)) {
			backups.push({ database, backupPath, absent: true });
			continue;
		}
		if (!lstatSync(source).isFile() || isSymlink(source))
			throw new Error("Invalid database backup source");
		rmSync(backupPath, { force: true });
		const db = new Database(source, { readonly: true, fileMustExist: true });
		try {
			await db.backup(backupPath);
		} finally {
			db.close();
		}
		chmodSync(backupPath, 0o600);
		const fd = openSync(backupPath, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		backups.push({ database, backupPath });
	}
	syncDirectory(root);
	syncDirectory(dirname(root));
	atomicPrivateJson(join(root, "snapshot.json"), {
		formatVersion: 1,
		transactionId: journal.transactionId,
		phase: "complete",
		createdAt: Date.now(),
	});
	return backups;
}
async function restoreDatabases(journal: ActivationJournal): Promise<void> {
	if (
		journal.backups.length !== 3 ||
		new Set(journal.backups.map((item) => item.database)).size !== 3
	)
		throw new Error("Incomplete activation backup");
	const Database = loadSqlite(journal.oldConfig);
	for (const item of journal.backups) {
		const destination = databasePath(journal.oldConfig, item.database);
		if (
			item.backupPath !==
			join(
				journal.oldConfig.homeDir,
				"state/backups",
				journal.transactionId,
				item.database,
			)
		)
			throw new Error("Unexpected backup path");
		for (const suffix of ["-wal", "-shm"])
			rmSync(`${destination}${suffix}`, { force: true });
		if (item.absent) {
			rmSync(destination, { force: true });
			syncDirectory(dirname(destination));
			continue;
		}
		const temporary = `${destination}.${journal.transactionId}.restore`;
		rmSync(temporary, { force: true });
		const db = new Database(item.backupPath, {
			readonly: true,
			fileMustExist: true,
		});
		try {
			await db.backup(temporary);
		} finally {
			db.close();
		}
		chmodSync(temporary, 0o600);
		const fd = openSync(temporary, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, destination);
		syncDirectory(dirname(destination));
	}
}
export async function finishPendingActivation(
	configPath: string,
	options: {
		phase?: ActivationPhase;
		stopCurrent?: () => Promise<void>;
		attempts?: number;
		delay?: () => Promise<void>;
	} = {},
): Promise<void> {
	if (!existsSync(join(dirname(configPath), "state/activation-journal.json")))
		return;
	const config = readServiceConfig(configPath);
	const path = join(config.homeDir, "state/activation-journal.json");
	if (!existsSync(path)) return;
	const releaseLock = acquireInstallerLock(
		join(config.homeDir, "state/activation-control.lock"),
	);
	try {
		const journal = JSON.parse(
			readPrivateBackendFile(path, 131072),
		) as ActivationJournal;
		if (
			journal.formatVersion !== 1 ||
			!UUID.test(journal.transactionId) ||
			![
				"preparing",
				"quiescing",
				"backed-up",
				"verifying",
				"committing",
				"committed",
				"rolling-back",
				"rollback-verifying",
				"rollback-committing",
				"rolled-back",
				"canceled",
			].includes(journal.phase)
		)
			throw new Error("Invalid activation journal");
		for (const stored of [journal.oldConfig, journal.candidateConfig]) {
			validateServiceConfig(stored, config.homeDir);
			if (
				stored.backendId !== config.backendId ||
				stored.namespaceId !== config.namespaceId
			)
				throw new Error("Activation identity mismatch");
		}
		const old =
			journal.phase === "rollback-verifying" ||
			journal.phase === "rollback-committing" ||
			journal.phase === "rolling-back";
		const expected = old ? journal.oldConfig : journal.candidateConfig;
		await advanceActivation(journal, options.phase ?? "before-start", {
			writeJournal: (value) => atomicPrivateJson(path, value),
			assertHostStopped: () => assertBackendStopped(config),
			backup: () => backupDatabases(journal),
			switchConfig: (value) => atomicPrivateJson(configPath, value),
			restore: () => restoreDatabases(journal),
			verify: async () => {
				for (let attempt = 0; attempt < (options.attempts ?? 40); attempt++) {
					try {
						const description = await backendRequest<
							Endpoint & { version: string }
						>(expected, "describe");
						if (
							description.instanceId === journal.oldInstanceId ||
							description.version !==
								(old ? journal.oldVersion : journal.candidateVersion)
						)
							throw new Error("Wrong backend release after activation");
						const maintenance = await backendRequest<MaintenanceStatus>(
							expected,
							"maintenance",
						);
						if (
							journal.phase === "committing" &&
							maintenance.mode === "active" &&
							!maintenance.frozen
						)
							return;
						assertSafeRestart(maintenance);
						if (
							maintenance.ownerId !== journal.transactionId ||
							maintenance.frozen !== true
						)
							throw new Error("Candidate is not frozen for this activation");
						return;
					} catch (error) {
						if (attempt + 1 >= (options.attempts ?? 40)) throw error;
						await (options.delay?.() ??
							new Promise<void>((resolve) => setTimeout(resolve, 250)));
					}
				}
			},
			endDrain: async () => {
				const maintenance = await backendRequest<MaintenanceStatus>(
					expected,
					"maintenance",
				);
				if (maintenance.mode === "active" && !maintenance.frozen) return;
				await backendRequest(expected, "end-drain", {
					ownerId: journal.transactionId,
				});
			},
			stopCurrent:
				options.stopCurrent ??
				(async () => {
					throw new Error(
						"Activation rollback requires the supervisor's owned-child stop callback",
					);
				}),
			prepareQuiescence: async () => {
				const maintenance = await backendRequest<MaintenanceStatus>(
					journal.oldConfig,
					"begin-drain",
					{ ownerId: journal.transactionId, freeze: false },
				);
				try {
					assertSafeRestart(maintenance);
				} catch {
					await backendRequest(journal.oldConfig, "end-drain", {
						ownerId: journal.transactionId,
					});
					return false;
				}
				await backendRequest(journal.oldConfig, "begin-drain", {
					ownerId: journal.transactionId,
					freeze: true,
				});
				return true;
			},
			verifyQuiescent: async () => {
				const description = await backendRequest<Endpoint>(
					journal.oldConfig,
					"describe",
				);
				const maintenance = await backendRequest<MaintenanceStatus>(
					journal.oldConfig,
					"maintenance",
				);
				assertSafeRestart(maintenance);
				if (
					description.instanceId !== journal.oldInstanceId ||
					maintenance.ownerId !== journal.transactionId ||
					maintenance.frozen !== true
				)
					throw new Error(
						"The owned old backend is not frozen for this activation",
					);
			},
			cancelPreparation: () =>
				clearOfflineMaintenance(journal.oldConfig, journal.transactionId),
		});
		if (journal.phase === "committed")
			rmSync(join(config.homeDir, "state/staged-release.json"), {
				force: true,
			});
		if (["committed", "rolled-back", "canceled"].includes(journal.phase)) {
			try {
				pruneManagedBackups(config.homeDir, journal.transactionId);
			} catch {
				process.stderr.write("Managed backup pruning was skipped\n");
			}
		}
	} finally {
		releaseLock();
	}
}
