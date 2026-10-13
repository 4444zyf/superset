import { chmodSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import BetterSqlite from "better-sqlite3";

export interface ConnectionProfile {
	id: string;
	kind?: "ssh" | "local";
	name: string;
	host: string;
	port?: number;
	user?: string;
	identityFile?: string;
	backendId?: string;
	namespaceId?: string;
	serviceUid?: number;
}

type SqliteValue = string | number | null;
export interface SqliteDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): {
		run(...values: SqliteValue[]): unknown;
		get(...values: SqliteValue[]): unknown;
		all(...values: SqliteValue[]): unknown;
	};
	close(): unknown;
}

const fields = new Set([
	"id",
	"kind",
	"name",
	"host",
	"port",
	"user",
	"identityFile",
	"backendId",
	"namespaceId",
	"serviceUid",
]);
export const uuidPattern =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const localConnectionId = "00000000-0000-4000-8000-000000000001";

export function validateProfile(value: unknown): ConnectionProfile {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid connection");
	const data = value as Record<string, unknown>;
	if (Object.keys(data).some((key) => !fields.has(key)))
		throw new Error("Unsupported connection field");
	if (typeof data.id !== "string" || !/^[\w-]{1,128}$/.test(data.id))
		throw new Error("Invalid connection id");
	if (data.kind !== undefined && data.kind !== "ssh" && data.kind !== "local")
		throw new Error("Invalid connection kind");
	if (
		data.kind === "local" &&
		(data.id !== localConnectionId ||
			data.host !== "localhost" ||
			data.user !== undefined ||
			data.port !== undefined ||
			data.identityFile !== undefined)
	)
		throw new Error("Invalid local connection");
	if (
		typeof data.name !== "string" ||
		!data.name.trim() ||
		data.name.length > 128
	)
		throw new Error("Invalid connection name");
	if (
		typeof data.host !== "string" ||
		!/^[a-z0-9][a-z0-9.\-[\]:_]{0,252}$/i.test(data.host)
	)
		throw new Error("Invalid SSH host or alias");
	if (
		data.user !== undefined &&
		(typeof data.user !== "string" ||
			!/^[a-z_][a-z0-9_.-]{0,63}$/i.test(data.user))
	)
		throw new Error("Invalid SSH user");
	if (
		data.port !== undefined &&
		(!Number.isInteger(data.port) ||
			Number(data.port) < 1 ||
			Number(data.port) > 65535)
	)
		throw new Error("Invalid SSH port");
	if (
		data.identityFile !== undefined &&
		(typeof data.identityFile !== "string" ||
			!isAbsolute(data.identityFile) ||
			/[\r\n\0]/.test(data.identityFile))
	)
		throw new Error("Invalid identity file");
	for (const field of ["backendId", "namespaceId"]) {
		if (
			data[field] !== undefined &&
			(typeof data[field] !== "string" || !uuidPattern.test(data[field]))
		)
			throw new Error("Invalid backend identity");
	}
	if (
		data.serviceUid !== undefined &&
		(!Number.isInteger(data.serviceUid) || Number(data.serviceUid) < 1)
	)
		throw new Error("Invalid service UID");
	return { ...data } as unknown as ConnectionProfile;
}

export class ConnectionRegistry {
	private readonly db: SqliteDatabase;
	constructor(database: string | SqliteDatabase) {
		if (typeof database === "string") {
			mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
			this.db = new BetterSqlite(database);
			chmodSync(database, 0o600);
		} else this.db = database;
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS direct_connections (id TEXT PRIMARY KEY, profile TEXT NOT NULL)",
		);
		this.db.exec(
			"BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS direct_connection_targets (id TEXT PRIMARY KEY, revision INTEGER NOT NULL); INSERT OR IGNORE INTO direct_connection_targets SELECT id, 1 FROM direct_connections; COMMIT;",
		);
	}
	list(): ConnectionProfile[] {
		return (
			this.db
				.prepare("SELECT profile FROM direct_connections ORDER BY id")
				.all() as { profile: string }[]
		).map((row) => validateProfile(JSON.parse(row.profile)));
	}
	get(id: string): ConnectionProfile | null {
		const row = this.db
			.prepare("SELECT profile FROM direct_connections WHERE id = ?")
			.get(id) as { profile: string } | undefined;
		return row ? validateProfile(JSON.parse(row.profile)) : null;
	}
	save(value: unknown): ConnectionProfile {
		const profile = validateProfile(value);
		const previous = this.get(profile.id);
		const changed =
			!!previous &&
			((previous.kind ?? "ssh") !== (profile.kind ?? "ssh") ||
				["host", "port", "user", "identityFile"].some(
					(field) =>
						previous[field as keyof ConnectionProfile] !==
						profile[field as keyof ConnectionProfile],
				));
		if (changed) {
			delete profile.backendId;
			delete profile.namespaceId;
			delete profile.serviceUid;
		} else if (previous) {
			profile.backendId ??= previous.backendId;
			profile.namespaceId ??= previous.namespaceId;
			profile.serviceUid ??= previous.serviceUid;
		}
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db
				.prepare(
					"INSERT INTO direct_connections (id, profile) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET profile = excluded.profile",
				)
				.run(profile.id, JSON.stringify(profile));
			this.db
				.prepare(
					"INSERT INTO direct_connection_targets (id,revision) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET revision=revision+?",
				)
				.run(profile.id, changed ? 1 : 0);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
		return profile;
	}
	remove(id: string): void {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.prepare("DELETE FROM direct_connections WHERE id = ?").run(id);
			this.db
				.prepare("DELETE FROM direct_connection_targets WHERE id = ?")
				.run(id);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
	getTargetRevision(id: string): number | null {
		const row = this.db
			.prepare("SELECT revision FROM direct_connection_targets WHERE id=?")
			.get(id) as { revision: number } | undefined;
		return row?.revision ?? null;
	}
	close(): void {
		this.db.close();
	}
}
