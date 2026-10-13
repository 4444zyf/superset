import { randomUUID } from "node:crypto";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import superjson from "superjson";
import NodeWebSocket from "ws";
import { DirectConnectionError, sshFailure } from "./errors";
import type { LocalBackend } from "./local";
import {
	type ConnectionProfile,
	type ConnectionRegistry,
	uuidPattern,
	validateProfile,
} from "./registry";
import {
	isSafeSocketPath,
	OpenSshRuntime,
	type RemoteTransport,
	type SshRuntime,
	type Tunnel,
} from "./ssh";

export interface EndpointDescriptor {
	backendId: string;
	namespaceId: string;
	instanceId: string;
	port: number;
	socketPath: string;
	serviceUid: number;
	runtimeMode: "direct";
	protocolVersion: number;
}
export interface ConnectionLease {
	connectionId: string;
	generation: number;
	backendId: string;
	namespaceId: string;
	instanceId: string;
	url: string;
}
export interface ConnectionStatus {
	state:
		| "disconnected"
		| "probing"
		| "installing"
		| "forwarding"
		| "verifying"
		| "ready"
		| "blocked";
	generation: number;
	error?: string;
}
export interface RemoteProbe {
	platform: string;
	architecture: string;
	uid: number;
	user: string;
	homeDir: string;
	installed: boolean;
	groupname?: string;
	macOS?: string;
}
export interface DirectRequest {
	path: string;
	method?: string;
	body?: string | Uint8Array;
	headers?: Record<string, string>;
}
interface Connected {
	lease: ConnectionLease;
	tunnel: Tunnel;
	secret: string;
	health: Record<string, unknown>;
}

const probeCommand =
	'/bin/sh -c \'printf "%s\\0" "$(uname -s)" "$(uname -m)" "$(id -u)" "$(id -un)" "$HOME"\'';
const endpointCommand =
	'/bin/sh -c \'test -r "$HOME/.superset-direct/state/endpoint.json" && test -r "$HOME/.superset-direct/credentials/host-secret" && cat "$HOME/.superset-direct/state/endpoint.json" && printf "\\n" && cat "$HOME/.superset-direct/credentials/host-secret"\'';
const restoreEndpointCommand = endpointCommand.replace(
	"test -r",
	'test ! -e "$HOME/.superset-direct/state/disabled" && test -r',
);

function parseEndpoint(raw: string): {
	descriptor: EndpointDescriptor;
	secret: string;
} {
	const body = raw.trim();
	const split = body.lastIndexOf("\n");
	const secret = body.slice(split + 1);
	if (split < 0 || !/^[a-f0-9]{64}$/i.test(secret))
		throw new Error("Invalid backend credentials");
	const descriptor = JSON.parse(body.slice(0, split)) as EndpointDescriptor;
	if (
		typeof descriptor.socketPath !== "string" ||
		!descriptor.socketPath.startsWith("/tmp/superset-direct-") ||
		!isSafeSocketPath(descriptor.socketPath)
	)
		throw new Error("Invalid private backend socket");
	if (
		!uuidPattern.test(descriptor.backendId) ||
		!uuidPattern.test(descriptor.namespaceId) ||
		!descriptor.instanceId ||
		descriptor.runtimeMode !== "direct" ||
		descriptor.protocolVersion !== 1 ||
		!Number.isInteger(descriptor.port) ||
		descriptor.port < 1 ||
		descriptor.port > 65535 ||
		!Number.isInteger(descriptor.serviceUid) ||
		descriptor.serviceUid < 1
	)
		throw new Error("Invalid direct endpoint");
	return { descriptor, secret };
}

function relativePath(path: string): string {
	if (
		!path.startsWith("/") ||
		path.startsWith("//") ||
		path.includes("\\") ||
		Array.from(path).some(
			(character) =>
				character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
		) ||
		path.split(/[/?#]/).includes("..") ||
		path.includes("#")
	)
		throw new Error("Invalid direct request path");
	return path;
}

function profileFingerprint(profile: ConnectionProfile | null): string {
	return JSON.stringify(
		profile && [
			profile.id,
			profile.kind ?? "ssh",
			profile.host,
			profile.port,
			profile.user,
			profile.identityFile,
			profile.backendId,
			profile.namespaceId,
			profile.serviceUid,
		],
	);
}

export class DirectConnectionManager {
	private readonly runtime: SshRuntime;
	private readonly requestFetch: (
		url: string,
		init?: RequestInit,
	) => Promise<Response>;
	private readonly connected = new Map<string, Connected>();
	private readonly statuses = new Map<string, ConnectionStatus>();
	private readonly pending = new Map<string, Promise<ConnectionLease>>();
	private readonly pendingModes = new Map<
		string,
		"explicit" | "restore-existing"
	>();
	private readonly sockets = new Map<string, Set<{ close(): void }>>();
	private readonly targets = new Map<string, string>();
	constructor(
		private readonly options: {
			registry: ConnectionRegistry;
			runtime?: SshRuntime;
			local?: Pick<LocalBackend, "test" | "connect">;
			install?: (
				profile: ConnectionProfile,
				transport: RemoteTransport,
				probe: RemoteProbe,
			) => Promise<void>;
			fetch?: (url: string, init?: RequestInit) => Promise<Response>;
			healthAttempts?: number;
			healthDelay?: number;
			onStatus?: (id: string, status: ConnectionStatus) => void;
		},
	) {
		this.runtime = options.runtime ?? new OpenSshRuntime();
		this.requestFetch = options.fetch ?? fetch;
	}
	private profile(id: string): ConnectionProfile {
		const profile = this.options.registry.get(id);
		if (!profile) throw new Error("Unknown SSH connection");
		return profile;
	}
	getStatus(id: string): ConnectionStatus {
		return {
			...(this.statuses.get(id) ?? { state: "disconnected", generation: 0 }),
		};
	}
	private setStatus(id: string, status: ConnectionStatus): void {
		this.statuses.set(id, status);
		this.options.onStatus?.(id, { ...status });
	}
	async withRemoteTransport<T>(
		id: string,
		action: (
			transport: RemoteTransport,
			profile: ConnectionProfile,
		) => Promise<T>,
	): Promise<T> {
		const profile = this.profile(id);
		if (profile.kind === "local")
			throw new Error("SSH controls cannot be used for the local backend");
		const fingerprint = profileFingerprint(profile);
		const result = await action(this.remoteTransport(profile), { ...profile });
		if (profileFingerprint(this.options.registry.get(id)) !== fingerprint)
			throw new Error("SSH connection configuration changed");
		return result;
	}
	getLease(id: string): ConnectionLease | null {
		const connection = this.connected.get(id);
		if (
			connection &&
			this.targets.get(id) !== profileFingerprint(this.options.registry.get(id))
		) {
			this.disconnect(id);
			return null;
		}
		return connection ? { ...connection.lease } : null;
	}
	async test(id: string): Promise<RemoteProbe> {
		const profile = this.profile(id);
		if (profile.kind === "local") {
			if (!this.options.local)
				throw new Error("The local backend is unavailable");
			return this.options.local.test();
		}
		return this.testProfile(profile);
	}
	getVerifiedDescription(id: string): Record<string, unknown> {
		return structuredClone(this.live(id).health);
	}
	async testProfile(input: ConnectionProfile): Promise<RemoteProbe> {
		const profile = { ...validateProfile(input), id: randomUUID() };
		if (profile.kind === "local")
			throw new Error("Use the managed local connection");
		try {
			const result = await this.runtime.exec(profile, probeCommand);
			if (result.exitCode !== 0) throw sshFailure(result.stderr);
			const [platform, architecture, uid, user, homeDir] =
				result.stdout.split("\0");
			if (
				!platform ||
				!architecture ||
				!user ||
				!homeDir?.startsWith("/") ||
				/[\r\n]/.test(homeDir) ||
				!Number.isInteger(Number(uid)) ||
				Number(uid) < 1
			)
				throw new Error("Invalid remote environment");
			const endpoint = await this.runtime.exec(profile, endpointCommand);
			return {
				platform: platform.toLowerCase(),
				architecture,
				uid: Number(uid),
				user,
				homeDir,
				installed: endpoint.exitCode === 0,
			};
		} finally {
			this.runtime.cancel?.(profile.id);
		}
	}
	connect(
		id: string,
		options: { mode?: "explicit" | "restore-existing" } = {},
	): Promise<ConnectionLease> {
		const mode = options.mode ?? "explicit";
		const live = this.getLease(id);
		if (live) {
			if (mode === "explicit") return Promise.resolve(live);
			if (this.options.registry.get(id)?.kind === "local")
				return Promise.reject(
					new Error(
						"Automatic window restore requires an existing SSH backend",
					),
				);
			const connection = this.live(id);
			return this.assertRestoreAvailable(
				connection.lease.url,
				connection.secret,
			).then(() => {
				this.current(id, live.generation);
				return live;
			});
		}
		const pending = this.pending.get(id);
		if (pending) {
			if (this.pendingModes.get(id) !== mode)
				return Promise.reject(
					new Error("A different connection operation is pending"),
				);
			return pending;
		}
		const generation = this.getStatus(id).generation + 1;
		this.setStatus(id, { state: "probing", generation });
		const promise = this.connectGeneration(id, generation, mode).finally(() => {
			if (this.pending.get(id) === promise) {
				this.pending.delete(id);
				this.pendingModes.delete(id);
			}
		});
		this.pending.set(id, promise);
		this.pendingModes.set(id, mode);
		return promise;
	}
	private current(id: string, generation: number): void {
		if (this.getStatus(id).generation !== generation)
			throw new Error("SSH connection cancelled");
		if (
			this.targets.get(id) !== profileFingerprint(this.options.registry.get(id))
		) {
			this.disconnect(id);
			throw new Error("SSH connection configuration changed");
		}
	}
	private remoteTransport(profile: ConnectionProfile): RemoteTransport {
		const uploadFiles = this.runtime.uploadFiles?.bind(this.runtime, profile);
		return {
			exec: (command, stdin) => this.runtime.exec(profile, command, stdin),
			upload: (local, remote) => this.runtime.upload(profile, local, remote),
			...(uploadFiles ? { uploadFiles } : {}),
		};
	}
	private async connectGeneration(
		id: string,
		generation: number,
		mode: "explicit" | "restore-existing",
	): Promise<ConnectionLease> {
		let tunnel: Tunnel | undefined;
		let disposeUnclaimed: (() => void) | undefined;
		try {
			const profile = this.profile(id);
			if (mode === "restore-existing" && profile.kind === "local")
				throw new Error(
					"Automatic window restore requires an existing SSH backend",
				);
			this.targets.set(id, profileFingerprint(profile));
			let initialEndpoint: string | undefined;
			let probe: RemoteProbe;
			if (profile.kind === "local") probe = await this.test(id);
			else {
				const result = await this.runtime.exec(
					profile,
					`${probeCommand}; printf '%s\\0' "$(id -gn)" "$(test "$(uname -s)" != Darwin || /usr/bin/sw_vers -productVersion)"; ${mode === "restore-existing" ? restoreEndpointCommand : endpointCommand}; true`,
				);
				if (result.exitCode !== 0) throw sshFailure(result.stderr);
				const [
					platform,
					architecture,
					uid,
					user,
					homeDir,
					groupname,
					macOS,
					...endpoint
				] = result.stdout.split("\0");
				if (
					!platform ||
					!architecture ||
					!user ||
					!homeDir?.startsWith("/") ||
					/[\r\n]/.test(homeDir) ||
					!Number.isSafeInteger(Number(uid)) ||
					Number(uid) < 1
				)
					throw new Error("Invalid remote environment");
				initialEndpoint = endpoint.join("\0");
				probe = {
					platform: platform.toLowerCase(),
					architecture,
					uid: Number(uid),
					user,
					homeDir,
					installed: !!initialEndpoint,
					groupname,
					macOS,
				};
			}
			this.current(id, generation);
			const backend = await this.resolveBackend(
				id,
				profile,
				generation,
				probe,
				initialEndpoint,
				mode,
			);
			disposeUnclaimed = backend.dispose;
			const { descriptor, secret } = backend;
			if (probe.uid !== descriptor.serviceUid)
				throw new Error("Backend identity does not belong to SSH user");
			for (const field of ["backendId", "namespaceId", "serviceUid"] as const) {
				if (
					profile[field] !== undefined &&
					profile[field] !== descriptor[field]
				)
					throw new Error(
						"Backend identity changed; verify the remote machine",
					);
			}
			this.current(id, generation);
			this.setStatus(id, { state: "forwarding", generation });
			tunnel = await backend.forward();
			this.current(id, generation);
			this.setStatus(id, { state: "verifying", generation });
			let health: Record<string, unknown> | undefined;
			for (
				let attempt = 0;
				attempt < (this.options.healthAttempts ?? 30);
				attempt++
			) {
				this.current(id, generation);
				try {
					const response = await this.requestFetch(
						`${tunnel.url}/direct/describe`,
						{
							headers: { Authorization: `Bearer ${secret}` },
							signal: AbortSignal.timeout(2000),
							redirect: "error",
						},
					);
					if (!response.ok)
						throw new DirectConnectionError(
							"Backend authentication failed",
							false,
						);
					health = (await response.json()) as Record<string, unknown>;
					break;
				} catch (error) {
					if (error instanceof DirectConnectionError && !error.retryable)
						throw error;
					if (attempt + 1 === (this.options.healthAttempts ?? 30))
						throw new DirectConnectionError(
							"SSH forward health check failed",
							true,
						);
					await new Promise((resolve) =>
						setTimeout(resolve, this.options.healthDelay ?? 100),
					);
				}
			}
			if (
				!health ||
				[
					"backendId",
					"namespaceId",
					"instanceId",
					"serviceUid",
					"runtimeMode",
					"protocolVersion",
					"socketPath",
				].some(
					(field) =>
						health[field] !== descriptor[field as keyof EndpointDescriptor],
				)
			)
				throw new Error("Backend identity mismatch");
			if (mode === "restore-existing")
				await this.assertRestoreAvailable(tunnel.url, secret);
			this.current(id, generation);
			const pinned = this.options.registry.save({
				...profile,
				backendId: descriptor.backendId,
				namespaceId: descriptor.namespaceId,
				serviceUid: descriptor.serviceUid,
			});
			this.targets.set(id, profileFingerprint(pinned));
			const lease: ConnectionLease = {
				connectionId: id,
				generation,
				url: tunnel.url,
				backendId: descriptor.backendId,
				namespaceId: descriptor.namespaceId,
				instanceId: descriptor.instanceId,
			};
			this.connected.set(id, { lease, tunnel, secret, health });
			this.setStatus(id, { state: "ready", generation });
			return { ...lease };
		} catch (error) {
			tunnel?.close();
			if (this.getStatus(id).generation === generation)
				this.runtime.cancel?.(id);
			if (!tunnel) disposeUnclaimed?.();
			if (this.getStatus(id).generation === generation)
				this.setStatus(id, {
					state: "blocked",
					generation,
					error: error instanceof Error ? error.message : "Connection failed",
				});
			throw error;
		}
	}
	private async assertRestoreAvailable(
		url: string,
		secret: string,
	): Promise<void> {
		const maintenance = await this.requestFetch(`${url}/direct/maintenance`, {
			headers: { Authorization: `Bearer ${secret}` },
			signal: AbortSignal.timeout(2000),
			redirect: "error",
		});
		const state = maintenance.ok
			? ((await maintenance.json()) as { mode?: string; frozen?: boolean })
			: null;
		if (state?.mode !== "active" || state.frozen !== false)
			throw new Error("The existing backend is unavailable for restore");
	}
	private async resolveBackend(
		id: string,
		profile: ConnectionProfile,
		generation: number,
		probe: RemoteProbe,
		initialEndpoint?: string,
		mode: "explicit" | "restore-existing" = "explicit",
	): Promise<{
		descriptor: EndpointDescriptor;
		secret: string;
		dispose?: () => void;
		forward(): Promise<Tunnel>;
	}> {
		if (profile.kind === "local") {
			if (!this.options.local)
				throw new Error("The local backend is unavailable");
			const local = await this.options.local.connect();
			try {
				this.current(id, generation);
				return {
					...parseEndpoint(
						`${JSON.stringify(local.descriptor)}\n${local.secret}`,
					),
					dispose: () => local.close(),
					forward: async () => local,
				};
			} catch (error) {
				local.close();
				throw error;
			}
		}
		let result =
			initialEndpoint === undefined
				? await this.runtime.exec(profile, endpointCommand)
				: {
						stdout: initialEndpoint,
						stderr: "",
						exitCode: initialEndpoint ? 0 : 1,
					};
		if (result.exitCode !== 0) {
			if (mode === "restore-existing")
				throw new Error(
					"The existing backend is unavailable; restore is paused",
				);
			if (!this.options.install)
				throw new Error(
					"Direct backend is not installed; select a verified backend release",
				);
			this.setStatus(id, { state: "installing", generation });
			await this.options.install(profile, this.remoteTransport(profile), probe);
			this.current(id, generation);
			result = await this.runtime.exec(profile, endpointCommand);
			if (result.exitCode !== 0)
				throw new Error("Backend installation did not become ready");
		}
		this.current(id, generation);
		const parsed = parseEndpoint(result.stdout);
		if (
			parsed.descriptor.socketPath !==
			directBackendSocketPath({
				homeDir: `${probe.homeDir}/.superset-direct`,
				backendId: parsed.descriptor.backendId,
				namespaceId: parsed.descriptor.namespaceId,
				uid: probe.uid,
			})
		)
			throw new Error("Unexpected private backend socket");
		return {
			...parsed,
			forward: () =>
				this.runtime.forward(profile, parsed.descriptor.socketPath, () => {
					if (this.getStatus(id).generation === generation) this.disconnect(id);
				}),
		};
	}
	disconnect(id: string): void {
		const connection = this.connected.get(id);
		this.connected.delete(id);
		this.pending.delete(id);
		this.pendingModes.delete(id);
		this.targets.delete(id);
		this.setStatus(id, {
			state: "disconnected",
			generation: this.getStatus(id).generation + 1,
		});
		for (const socket of this.sockets.get(id) ?? []) socket.close();
		this.sockets.delete(id);
		this.runtime.cancel?.(id);
		connection?.tunnel.close();
	}
	dispose(): void {
		for (const id of this.statuses.keys()) this.disconnect(id);
		this.runtime.dispose?.();
	}
	private live(id: string): Connected {
		const connection = this.connected.get(id);
		if (!connection || this.getStatus(id).state !== "ready")
			throw new Error("SSH backend is not connected");
		this.current(id, connection.lease.generation);
		return connection;
	}
	async request(id: string, input: DirectRequest): Promise<Response> {
		const path = relativePath(input.path);
		const connection = this.live(id);
		const headers = new Headers(input.headers);
		for (const forbidden of [
			"authorization",
			"cookie",
			"host",
			"origin",
			"proxy-authorization",
		])
			if (headers.has(forbidden)) throw new Error("Forbidden direct header");
		headers.set("Authorization", `Bearer ${connection.secret}`);
		const response = await this.requestFetch(`${connection.lease.url}${path}`, {
			method: input.method ?? "GET",
			body: input.body as RequestInit["body"],
			headers,
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		this.current(id, connection.lease.generation);
		return response;
	}
	async invoke(
		id: string,
		input: { path: string; type: "query" | "mutation"; input?: unknown },
	): Promise<unknown> {
		if (
			!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(input.path) ||
			!["query", "mutation"].includes(input.type)
		)
			throw new Error("Invalid RPC operation");
		const generation = this.live(id).lease.generation;
		const payload = superjson.stringify(input.input);
		const path = `/trpc/${input.path}${input.type === "query" ? `?input=${encodeURIComponent(payload)}` : ""}`;
		const response = await this.request(id, {
			path,
			method: input.type === "query" ? "GET" : "POST",
			body: input.type === "mutation" ? payload : undefined,
			headers: { "Content-Type": "application/json" },
		});
		const envelope = (await response.json()) as {
			result?: { data: Parameters<typeof superjson.deserialize>[0] };
			error?: { json?: { message?: string }; message?: string };
		};
		this.current(id, generation);
		if (!response.ok || envelope.error || !envelope.result)
			throw new Error(
				envelope.error?.json?.message ??
					envelope.error?.message ??
					"Backend RPC failed",
			);
		return superjson.deserialize(envelope.result.data);
	}
	openSocket(id: string, path: string): WebSocket {
		const connection = this.live(id);
		const url = new URL(relativePath(path), connection.lease.url);
		if (url.origin !== new URL(connection.lease.url).origin)
			throw new Error("Invalid direct socket origin");
		url.protocol = "ws:";
		url.searchParams.set("token", connection.secret);
		const socket = new WebSocket(url);
		const sockets = this.sockets.get(id) ?? new Set<WebSocket>();
		this.sockets.set(id, sockets);
		sockets.add(socket);
		socket.addEventListener("close", () => sockets.delete(socket));
		return socket;
	}
	openRestoredSocket(id: string, path: string): NodeWebSocket {
		const connection = this.live(id);
		if (
			!/^\/terminal-restore\/[\w-]+\?workspaceId=[\w-]+&executionId=[\w-]+$/.test(
				path,
			)
		)
			throw new Error("Invalid restored terminal path");
		const url = new URL(path, connection.lease.url);
		url.protocol = "ws:";
		const socket = new NodeWebSocket(url, {
			headers: { Authorization: `Bearer ${connection.secret}` },
		});
		const sockets = this.sockets.get(id) ?? new Set<{ close(): void }>();
		this.sockets.set(id, sockets);
		sockets.add(socket);
		socket.addEventListener("close", () => sockets.delete(socket));
		return socket;
	}
}
