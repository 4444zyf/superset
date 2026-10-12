import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readlinkSync,
	readSync,
	renameSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type {
	ImportedLegacyHistoryChunk,
	ImportedLegacyHistoryPage,
	LegacyDiscovery,
	LegacyImportPreview,
	LocalDataQuery,
} from "@superset/shared/direct-legacy-data";
import {
	LocalBackend,
	type LocalBackendOptions,
	type LocalConnection,
	type LocalLegacyImportResult,
} from "./local";
import { runLocalImportProcess } from "./local-import-process";
import type { RemoteProbe } from "./manager";
import { uuidPattern } from "./registry";

export interface LocalNamespace {
	id: string;
	label: string;
	selected: boolean;
	isDefault: boolean;
	backendId: string;
	namespaceId: string;
}
interface Entry {
	id: string;
	backendId: string;
	label: string;
	isDefault: boolean;
	createdAt: number;
	sourceId?: string;
	sourceNamespace?: string;
}
interface Catalog {
	version: 1;
	activeId: string;
	revision: number;
	entries: Entry[];
}
type NamespaceBackend = Pick<
	LocalBackend,
	"describeNamespace" | "test" | "connect" | "control" | "importLocalData"
>;
export interface LocalNamespaceBackendOptions extends LocalBackendOptions {
	createBackend?: (options: LocalBackendOptions) => NamespaceBackend;
	queryLocalData?: (
		configPath: string,
		query: LocalDataQuery,
	) => Promise<unknown>;
}
function directory(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error("Local namespaces require owner-only real directories");
}
function absent(path: string): boolean {
	try {
		lstatSync(path);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
}
function privateJson(path: string): unknown {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.uid !== process.getuid?.() ||
			(stat.mode & 0o077) !== 0 ||
			stat.size > 256 * 1024
		)
			throw new Error(
				"Local namespace metadata must be a bounded private regular file",
			);
		const buffer = Buffer.alloc(256 * 1024 + 1);
		let bytes = 0;
		while (bytes < buffer.length) {
			const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
			if (!count) break;
			bytes += count;
		}
		if (bytes > 256 * 1024)
			throw new Error("Local namespace metadata exceeds its byte limit");
		return JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
	} finally {
		closeSync(fd);
	}
}
function sync(path: string): void {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
function live(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid < 1)
		throw new Error("Namespace process identity cannot be verified");
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw new Error("Namespace process ownership cannot be verified");
	}
}
function validLabel(label: string): string {
	if (
		typeof label !== "string" ||
		!label.trim() ||
		label.length > 128 ||
		/[\0\r\n]/.test(label)
	)
		throw new Error("A namespace label must contain 1 to 128 characters");
	return label.trim();
}
function acquireCatalogLock(path: string, depth = 0): () => void {
	if (depth > 8)
		throw new Error("Catalog lock recovery requires explicit repair");
	const owner = `superset-local-catalog-${process.pid}-${randomUUID()}`;
	const ownerPid = () => {
		const stat = lstatSync(path);
		if (!stat.isSymbolicLink() || stat.uid !== process.getuid?.())
			throw new Error("Invalid local namespace catalog lock");
		const match = /^superset-local-catalog-(\d+)-[a-f0-9-]{36}$/.exec(
			readlinkSync(path),
		);
		if (!match) throw new Error("Invalid local namespace catalog lock owner");
		return Number(match[1]);
	};
	try {
		symlinkSync(owner, path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if (live(ownerPid()))
			throw new Error("Another local namespace update is in progress");
		const releaseRecovery = acquireCatalogLock(`${path}.recovery`, depth + 1);
		try {
			if (!absent(path)) {
				if (live(ownerPid()))
					throw new Error("Another local namespace update is in progress");
				unlinkSync(path);
			}
			symlinkSync(owner, path);
		} finally {
			releaseRecovery();
		}
	}
	return () => {
		try {
			if (readlinkSync(path) === owner) unlinkSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	};
}

/** One stable local connection selects among independently owned backend homes. */
export class LocalNamespaceBackend {
	private readonly options: LocalNamespaceBackendOptions;
	private readonly backends = new Map<string, NamespaceBackend>();
	private readonly proxies = new Set<LocalConnection>();
	private selectedId: string | undefined;
	private revision = 0;
	constructor(options: LocalNamespaceBackendOptions) {
		if (!isAbsolute(options.dataDir) || !process.getuid?.())
			throw new Error(
				"Local namespaces require an ordinary OS user and absolute data directory",
			);
		this.options = options;
	}
	private catalogPath(): string {
		return join(this.options.dataDir, "local-namespaces.json");
	}
	private home(entry: Entry): string {
		return entry.isDefault
			? this.options.dataDir
			: join(this.options.dataDir, "namespaces", entry.id);
	}
	private validateHome(entry: Entry): void {
		directory(this.options.dataDir);
		if (!entry.isDefault) directory(join(this.options.dataDir, "namespaces"));
		directory(this.home(entry));
	}
	private lock(): () => void {
		directory(this.options.dataDir);
		return acquireCatalogLock(
			join(this.options.dataDir, "local-namespaces.lock"),
		);
	}
	private readCatalog(): Catalog | undefined {
		if (absent(this.catalogPath())) return undefined;
		const value = privateJson(this.catalogPath()) as Catalog;
		if (
			!value ||
			value.version !== 1 ||
			!uuidPattern.test(value.activeId) ||
			!Number.isSafeInteger(value.revision) ||
			value.revision < 0 ||
			!Array.isArray(value.entries) ||
			value.entries.length < 1 ||
			value.entries.length > 32 ||
			value.entries.filter((entry) => entry.isDefault).length !== 1
		)
			throw new Error("Invalid local namespace catalog");
		const ids = new Set<string>(),
			backends = new Set<string>();
		for (const entry of value.entries) {
			if (
				!entry ||
				!uuidPattern.test(entry.id) ||
				!uuidPattern.test(entry.backendId) ||
				typeof entry.isDefault !== "boolean" ||
				!Number.isSafeInteger(entry.createdAt) ||
				entry.createdAt < 0 ||
				ids.has(entry.id) ||
				backends.has(entry.backendId) ||
				Object.keys(entry).some(
					(key) =>
						![
							"id",
							"backendId",
							"label",
							"isDefault",
							"createdAt",
							"sourceId",
							"sourceNamespace",
						].includes(key),
				) ||
				(entry.sourceId !== undefined &&
					!/^[a-f0-9]{64}$/.test(entry.sourceId)) ||
				(entry.sourceNamespace !== undefined &&
					(typeof entry.sourceNamespace !== "string" ||
						entry.sourceNamespace.length > 128))
			)
				throw new Error("Invalid local namespace entry");
			validLabel(entry.label);
			ids.add(entry.id);
			backends.add(entry.backendId);
		}
		if (!ids.has(value.activeId))
			throw new Error("The selected namespace is missing");
		return value;
	}
	private save(catalog: Catalog): void {
		const path = this.catalogPath(),
			temporary = `${path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, JSON.stringify(catalog), {
				mode: 0o600,
				flag: "wx",
			});
			sync(temporary);
			renameSync(temporary, path);
			sync(this.options.dataDir);
		} finally {
			if (!absent(temporary)) unlinkSync(temporary);
		}
	}
	private catalog(): Catalog {
		directory(this.options.dataDir);
		let catalog = this.readCatalog();
		if (!catalog) {
			const release = this.lock();
			try {
				catalog = this.readCatalog();
				if (!catalog) {
					const backend = (
							this.options.createBackend ??
							((options) => new LocalBackend(options))
						)(this.options),
						identity = backend.describeNamespace();
					catalog = {
						version: 1,
						activeId: identity.namespaceId,
						revision: 0,
						entries: [
							{
								id: identity.namespaceId,
								backendId: identity.backendId,
								label: "Local",
								isDefault: true,
								createdAt: Date.now(),
							},
						],
					};
					this.backends.set(identity.namespaceId, backend);
					this.save(catalog);
				}
			} finally {
				release();
			}
		}
		if (!this.selectedId) {
			this.selectedId = catalog.activeId;
			this.revision = catalog.revision;
		}
		return catalog;
	}
	private entry(id?: string): Entry {
		const catalog = this.catalog(),
			entry = catalog.entries.find((row) => row.id === (id ?? this.selectedId));
		if (!entry) throw new Error("Unknown local namespace");
		return entry;
	}
	private backend(entry: Entry): NamespaceBackend {
		this.validateHome(entry);
		let backend = this.backends.get(entry.id);
		if (!backend) {
			backend = (
				this.options.createBackend ?? ((options) => new LocalBackend(options))
			)({
				...this.options,
				dataDir: this.home(entry),
				namespaceIdentity: {
					backendId: entry.backendId,
					namespaceId: entry.id,
				},
			});
			this.backends.set(entry.id, backend);
		}
		const identity = backend.describeNamespace();
		if (
			identity.backendId !== entry.backendId ||
			identity.namespaceId !== entry.id
		)
			throw new Error("Local namespace identity does not match its catalog");
		return backend;
	}
	private descriptor(entry: Entry): LocalNamespace {
		return {
			id: entry.id,
			label: entry.label,
			selected: entry.id === this.selectedId,
			isDefault: entry.isDefault,
			backendId: entry.backendId,
			namespaceId: entry.id,
		};
	}
	listNamespaces(): LocalNamespace[] {
		return this.catalog().entries.map((entry) => this.descriptor(entry));
	}
	getSelectionRevision(): number {
		this.catalog();
		return this.revision;
	}
	createNamespace(label: string): LocalNamespace {
		label = validLabel(label);
		this.catalog();
		const release = this.lock();
		try {
			const catalog = this.readCatalog();
			if (!catalog) throw new Error("The namespace catalog disappeared");
			if (catalog.entries.length >= 32)
				throw new Error(
					"The local namespace catalog is full; remove an inactive entry first",
				);
			const entry: Entry = {
				id: randomUUID(),
				backendId: randomUUID(),
				label,
				isDefault: false,
				createdAt: Date.now(),
			};
			directory(join(this.options.dataDir, "namespaces"));
			directory(this.home(entry));
			directory(join(this.home(entry), "state"));
			writeFileSync(
				join(this.home(entry), "state", "disabled"),
				"new-namespace-stopped\n",
				{ mode: 0o600, flag: "wx" },
			);
			this.backend(entry);
			catalog.entries.push(entry);
			this.save(catalog);
			return this.descriptor(entry);
		} finally {
			release();
		}
	}
	selectNamespace(id: string): LocalNamespace {
		const selected = this.entry(id);
		this.backend(selected);
		const release = this.lock();
		try {
			const catalog = this.readCatalog();
			if (!catalog || !catalog.entries.some((entry) => entry.id === id))
				throw new Error("The namespace disappeared");
			catalog.activeId = id;
			catalog.revision = Math.max(catalog.revision, this.revision) + 1;
			this.save(catalog);
			this.selectedId = id;
			this.revision = catalog.revision;
		} finally {
			release();
		}
		for (const proxy of [...this.proxies]) proxy.close();
		return this.descriptor(selected);
	}
	async test(): Promise<RemoteProbe> {
		const entry = this.entry(),
			revision = this.revision;
		const result = await this.backend(entry).test();
		if (revision !== this.revision || entry.id !== this.selectedId)
			throw new Error("Local namespace selection changed");
		return result;
	}
	async connect(): Promise<LocalConnection> {
		const entry = this.entry(),
			revision = this.revision;
		const proxy = await this.backend(entry).connect();
		if (revision !== this.revision || entry.id !== this.selectedId) {
			proxy.close();
			throw new Error("Local namespace selection changed");
		}
		let closed = false;
		const owned: LocalConnection = {
			...proxy,
			close: () => {
				if (closed) return;
				closed = true;
				this.proxies.delete(owned);
				proxy.close();
			},
		};
		this.proxies.add(owned);
		return owned;
	}
	control(action: "start" | "stop"): Promise<{ status: "completed" }> {
		const entry = this.entry();
		return this.backend(entry).control(action);
	}
	async stop(): Promise<void> {
		await this.control("stop");
	}
	private assertStopped(entry: Entry): void {
		const home = this.home(entry),
			state = join(home, "state");
		this.validateHome(entry);
		directory(state);
		const disabled = join(state, "disabled");
		const fd = openSync(
			disabled,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		try {
			const stat = fstatSync(fd);
			if (
				!stat.isFile() ||
				stat.uid !== process.getuid?.() ||
				(stat.mode & 0o077) !== 0 ||
				stat.size > 64 * 1024
			)
				throw new Error("Stop this namespace before removing it");
		} finally {
			closeSync(fd);
		}
		for (const name of [
			"endpoint.json",
			"legacy-import.lock",
			"legacy-import-recovery.lock",
		])
			if (!absent(join(state, name)))
				throw new Error("The namespace is active or has an unresolved import");
		const lock = join(state, "backend.lock");
		if (!absent(lock)) {
			const stat = lstatSync(lock);
			if (!stat.isSymbolicLink() || stat.uid !== process.getuid?.())
				throw new Error("Namespace backend activity cannot be verified");
			const owner = /^superset-direct-lock-(\d+)-[a-f0-9-]{36}$/.exec(
				readlinkSync(lock),
			);
			if (!owner || live(Number(owner[1])))
				throw new Error("A namespace backend is still active");
		}
		const manifest = join(home, "host", entry.id, "pty-daemon-manifest.json");
		if (!absent(manifest)) {
			const value = privateJson(manifest) as { pid: number };
			if (!value || live(value.pid))
				throw new Error("A namespace terminal daemon is still active");
		}
	}
	removeNamespace(id: string): void {
		const entry = this.entry(id);
		if (entry.isDefault || entry.id === this.selectedId)
			throw new Error("The default or selected namespace cannot be removed");
		this.assertStopped(entry);
		const release = this.lock();
		try {
			const catalog = this.readCatalog();
			if (!catalog) throw new Error("The namespace catalog disappeared");
			this.assertStopped(entry);
			catalog.entries = catalog.entries.filter((row) => row.id !== id);
			if (catalog.activeId === id)
				catalog.activeId = this.selectedId ?? catalog.entries[0]?.id ?? "";
			this.save(catalog);
			this.backends.delete(id);
		} finally {
			release();
		}
	}
	async importLocalData(
		sourceDirectory: string,
		options: {
			namespaceId?: string;
			createNamespace?: boolean;
			label?: string;
		} = {},
	): Promise<LocalLegacyImportResult & { destinationNamespaceId: string }> {
		const created = options.createNamespace
			? this.createNamespace(
					options.label ??
						`Imported ${basename(sourceDirectory)}`.slice(0, 128),
				)
			: undefined;
		const entry = this.entry(created?.id ?? options.namespaceId),
			backend = this.backend(entry);
		try {
			const result = await backend.importLocalData(sourceDirectory);
			const release = this.lock();
			try {
				const catalog = this.readCatalog(),
					row = catalog?.entries.find((row) => row.id === entry.id);
				if (catalog && row) {
					row.sourceNamespace = result.sourceNamespace.slice(0, 128);
					this.save(catalog);
				}
			} finally {
				release();
			}
			return { ...result, destinationNamespaceId: entry.id };
		} catch (error) {
			if (created && absent(join(this.home(entry), "host", entry.id))) {
				try {
					this.removeNamespace(entry.id);
				} catch {
					/* Keep unresolved imports visible for repair. */
				}
			}
			throw error;
		}
	}
	private async query<T>(
		request: LocalDataQuery,
		namespaceId?: string,
	): Promise<T> {
		const entry = this.entry(namespaceId),
			revision = this.revision;
		this.backend(entry);
		const configPath = join(this.home(entry), "service-config.json");
		let result: unknown;
		if (this.options.queryLocalData)
			result = await this.options.queryLocalData(configPath, request);
		else {
			const serialized = JSON.stringify(request);
			if (Buffer.byteLength(serialized) > 32 * 1024)
				throw new Error("Select fewer sources for one preview");
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
			const output = await runLocalImportProcess({
				executable: this.options.execPath,
				args: [
					this.options.hostServicePath,
					"--query-local-data",
					serialized,
					"--config",
					configPath,
				],
				cwd: this.home(entry),
				environment,
				maxOutputBytes: 1024 * 1024,
			});
			result = JSON.parse(output);
		}
		if (revision !== this.revision)
			throw new Error("Local namespace selection changed");
		return result as T;
	}
	discoverLegacySources(): Promise<LegacyDiscovery> {
		return this.query({
			action: "discover",
			userHomeDirectory: this.options.homeDir ?? homedir(),
		});
	}
	async previewLegacySources(
		sourceIds: string[],
	): Promise<LegacyImportPreview> {
		const discovered = await this.discoverLegacySources();
		if (
			!Array.isArray(sourceIds) ||
			sourceIds.length > 32 ||
			new Set(sourceIds).size !== sourceIds.length
		)
			throw new Error("Select at most 32 distinct discovered sources");
		const sources = sourceIds.map((id) => {
			const source = discovered.sources.find((source) => source.id === id);
			if (!source)
				throw new Error("The selected source is no longer available");
			return source;
		});
		return this.query({ action: "preview", sources });
	}
	listLegacyHistory(
		options: { namespaceId?: string; offset?: number; limit?: number } = {},
	): Promise<ImportedLegacyHistoryPage> {
		return this.query(
			{ action: "listHistory", offset: options.offset, limit: options.limit },
			options.namespaceId,
		);
	}
	readLegacyHistory(options: {
		namespaceId?: string;
		workspaceId: string;
		terminalId: string;
		byteOffset?: number;
		byteLimit?: number;
	}): Promise<ImportedLegacyHistoryChunk> {
		return this.query(
			{
				action: "readHistory",
				workspaceId: options.workspaceId,
				terminalId: options.terminalId,
				byteOffset: options.byteOffset,
				byteLimit: options.byteLimit,
			},
			options.namespaceId,
		);
	}
}
