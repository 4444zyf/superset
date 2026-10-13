import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { SshRuntime } from "./index";
import {
	ConnectionRegistry,
	DirectConnectionManager,
	forwardArguments,
	localConnectionId,
	masterArguments,
	sshArguments,
} from "./index";
import type { LocalBackend } from "./local";

const profile = { id: "mac", name: "Mac mini", host: "mini" };

test("an unsaved SSH profile probe leaves registry pins, connection state and backend untouched", async () => {
	const f = fixture();
	const before = f.registry.list();
	const probe = await f.manager.testProfile({
		id: "draft",
		name: "Draft",
		host: "mini.example",
	});
	expect(probe).toMatchObject({
		platform: "darwin",
		architecture: "arm64",
		installed: true,
	});
	expect(f.registry.list()).toEqual(before);
	expect(f.registry.get("draft")).toBeNull();
	expect(f.manager.getLease("draft")).toBeNull();
	expect(f.requests).toEqual([]);
	await expect(
		f.manager.testProfile({
			id: "draft",
			name: "Draft",
			host: "-oProxyCommand=bad",
		}),
	).rejects.toThrow("Invalid SSH host");
});
const descriptor = {
	backendId: "5b2ea852-8428-4a22-91e6-980f81432131",
	namespaceId: "18817038-3f91-4c8c-99e5-7267c6398f0a",
	instanceId: "boot-one",
	port: 45221,
	serviceUid: 501,
	runtimeMode: "direct" as const,
	protocolVersion: 1,
	socketPath: `/tmp/superset-direct-501-${createHash("sha256")
		.update(
			JSON.stringify([
				"/Users/alice/.superset-direct",
				"5b2ea852-8428-4a22-91e6-980f81432131",
				"18817038-3f91-4c8c-99e5-7267c6398f0a",
			]),
		)
		.digest("hex")
		.slice(0, 32)}/control.sock`,
};
const secret = "ab".repeat(32);

function fixture(
	options: {
		describe?: unknown;
		endpoint?: unknown;
		probeFailure?: string;
		forward?: SshRuntime["forward"];
		rpcBody?: ReadableStream<Uint8Array>;
		local?: Pick<LocalBackend, "test" | "connect">;
		runtime?: SshRuntime;
		install?: ConstructorParameters<
			typeof DirectConnectionManager
		>[0]["install"];
	} = {},
) {
	const db = new Database(":memory:");
	const registry = new ConnectionRegistry(db);
	registry.save(profile);
	let closed = 0;
	let exit = () => {};
	const runtime: SshRuntime = {
		exec: async (_profile, command) => ({
			exitCode: command.includes("uname") && options.probeFailure ? 255 : 0,
			stderr: options.probeFailure ?? "",
			stdout: command.includes("uname")
				? ["Darwin", "arm64", "501", "alice", "/Users/alice", ""].join("\0")
				: `${JSON.stringify(options.endpoint ?? descriptor)}\n${secret}`,
		}),
		upload: async () => {},
		forward:
			options.forward ??
			(async (_profile, _port, onExit) => {
				exit = onExit;
				return {
					url: "http://127.0.0.1:12345",
					close: () => {
						closed++;
					},
				};
			}),
	};
	const requests: { url: string; authorization: string | null }[] = [];
	const manager = new DirectConnectionManager({
		registry,
		runtime: options.runtime ?? runtime,
		local: options.local,
		install: options.install,
		fetch: async (input, init) => {
			requests.push({
				url: String(input),
				authorization: new Headers(init?.headers).get("Authorization"),
			});
			if (String(input).includes("/trpc/") && options.rpcBody)
				return new Response(options.rpcBody);
			return Response.json(options.describe ?? descriptor);
		},
	});
	return {
		manager,
		registry,
		requests,
		exit: () => exit(),
		closed: () => closed,
	};
}

describe("direct connections", () => {
	test("the first explicit connection installs a missing backend before forwarding and reuses it on reconnect", async () => {
		let installed = false;
		const events: string[] = [];
		const f = fixture({
			runtime: {
				exec: async (_profile, command) => {
					if (command.includes("uname"))
						return {
							exitCode: 0,
							stderr: "",
							stdout: [
								"Darwin",
								"arm64",
								"501",
								"alice",
								"/Users/alice",
								"",
							].join("\0"),
						};
					return {
						exitCode: installed ? 0 : 1,
						stderr: "",
						stdout: installed ? `${JSON.stringify(descriptor)}\n${secret}` : "",
					};
				},
				upload: async () => {},
				forward: async () => {
					events.push("forward");
					return { url: "http://127.0.0.1:12345", close() {} };
				},
			},
			install: async (target) => {
				expect(target.id).toBe("mac");
				expect(f.manager.getStatus("mac").state).toBe("installing");
				events.push("install");
				installed = true;
			},
		});
		try {
			expect((await f.manager.test("mac")).installed).toBe(false);
			expect(events).toEqual([]);
			await f.manager.connect("mac");
			expect(f.manager.getStatus("mac").state).toBe("ready");
			expect(events).toEqual(["install", "forward"]);
			f.manager.disconnect("mac");
			await f.manager.connect("mac");
			expect(events).toEqual(["install", "forward", "forward"]);
		} finally {
			f.manager.dispose();
			f.registry.close();
		}
	});
	test.each([
		["ssh: connect to host mini port 22: Connection timed out", true],
		["alice@mini: Permission denied (publickey).", false],
		["Host key verification failed.", false],
	] as const)("SSH failures only allow bounded retries for transport errors: %s", async (probeFailure, retryable) => {
		const f = fixture({ probeFailure });
		try {
			const error = await f.manager
				.test("mac")
				.catch((value: unknown) => value);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error & { retryable: boolean }).retryable).toBe(
				retryable,
			);
		} finally {
			f.manager.dispose();
			f.registry.close();
		}
	});
	test("a local proxy arriving after disconnect is closed without stopping its backend", async () => {
		let entered: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let closed = 0;
		const f = fixture({
			local: {
				test: async () => ({
					platform: "linux",
					architecture: "x64",
					uid: 501,
					user: "alice",
					homeDir: "/home/alice",
					installed: true,
				}),
				connect: async () => {
					entered();
					await gate;
					return {
						descriptor,
						secret,
						url: "http://127.0.0.1:45678",
						close() {
							closed++;
						},
					};
				},
			},
		});
		f.registry.save({
			id: localConnectionId,
			kind: "local",
			name: "Local",
			host: "localhost",
		});
		const pending = f.manager.connect(localConnectionId);
		await started;
		f.manager.disconnect(localConnectionId);
		release();
		try {
			await expect(pending).rejects.toThrow("cancelled");
			expect(closed).toBe(1);
		} finally {
			f.manager.dispose();
			f.registry.close();
		}
	});
	test.each([
		undefined,
		"/tmp/attacker.sock",
		"relative.sock",
		"/tmp/a\n.sock",
	])("a missing or unexpected private socket blocks before forwarding or sending credentials (%s)", async (socketPath) => {
		let forwarded = 0;
		const f = fixture({
			endpoint: { ...descriptor, socketPath },
			forward: async () => {
				forwarded++;
				return { url: "http://127.0.0.1:12345", close() {} };
			},
		});
		try {
			await expect(f.manager.connect("mac")).rejects.toThrow("socket");
			expect(forwarded).toBe(0);
			expect(f.requests).toEqual([]);
		} finally {
			f.manager.dispose();
			f.registry.close();
		}
	});
	test("SSH only forwards the verified private socket rather than the legacy TCP port", async () => {
		const targets: (number | string)[] = [];
		const f = fixture({
			forward: async (_profile, target) => {
				targets.push(target);
				return { url: "http://127.0.0.1:12345", close() {} };
			},
		});
		try {
			await f.manager.connect("mac");
			expect(targets).toEqual([descriptor.socketPath]);
		} finally {
			f.manager.dispose();
			f.registry.close();
		}
	});
	test("streamlocal forwarding uses one safe Unix target argument", () => {
		expect(
			forwardArguments(
				"mini",
				"/tmp/control",
				"/tmp/empty",
				45678,
				"/tmp/private/control.sock",
			),
		).toContain("127.0.0.1:45678:/tmp/private/control.sock");
	});
	test("the local target uses its independent backend without invoking SSH", async () => {
		let closed = 0;
		const f = fixture({
			forward: async () => {
				throw new Error("Local connection invoked SSH");
			},
			local: {
				test: async () => ({
					platform: "linux",
					architecture: "x64",
					uid: 501,
					user: "alice",
					homeDir: "/home/alice",
					installed: true,
				}),
				connect: async () => ({
					descriptor,
					secret,
					url: "http://127.0.0.1:45678",
					close: () => {
						closed++;
					},
				}),
			},
		});
		f.registry.save({
			id: localConnectionId,
			kind: "local",
			name: "Local",
			host: "localhost",
		});
		const lease = await f.manager.connect(localConnectionId);
		expect(lease.url).toBe("http://127.0.0.1:45678");
		expect(f.requests[0]?.authorization).toBe(`Bearer ${secret}`);
		await expect(
			f.manager.withRemoteTransport(localConnectionId, async () => {}),
		).rejects.toThrow("local");
		f.manager.disconnect(localConnectionId);
		expect(closed).toBe(1);
		f.manager.dispose();
		f.registry.close();
	});
	test.each([
		"disconnect",
		"edit",
	] as const)("%s while an RPC body is pending rejects the stale result", async (action) => {
		let entered: () => void = () => {};
		const reading = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const body = new ReadableStream<Uint8Array>(
			{
				start(value) {
					controller = value;
				},
				pull() {
					entered();
				},
			},
			{ highWaterMark: 0 },
		);
		const f = fixture({ rpcBody: body });
		await f.manager.connect("mac");
		const pending = f.manager.invoke("mac", {
			path: "project.list",
			type: "query",
		});
		await reading;
		if (action === "disconnect") f.manager.disconnect("mac");
		else f.registry.save({ ...profile, host: "replacement-mini" });
		if (!controller) throw new Error("Response stream was not initialized");
		controller.enqueue(
			new TextEncoder().encode(
				JSON.stringify({ result: { data: { json: "stale backend data" } } }),
			),
		);
		controller.close();
		await expect(pending).rejects.toThrow();
		f.manager.dispose();
		f.registry.close();
	});
	test("pins identity only after authenticated health and never persists PSK", async () => {
		const { manager, registry, requests } = fixture();
		const lease = await manager.connect("mac");
		expect(lease.backendId).toBe(descriptor.backendId);
		expect(registry.get("mac")?.backendId).toBe(descriptor.backendId);
		expect(requests[0]?.authorization).toBe(`Bearer ${secret}`);
		expect(JSON.stringify([registry.list(), lease])).not.toContain(secret);
		manager.dispose();
		registry.close();
	});
	test("renaming a connection preserves its trusted backend identity", async () => {
		const f = fixture();
		await f.manager.connect("mac");
		const renamed = f.registry.save({ ...profile, name: "Renamed mini" });
		expect(renamed.backendId).toBe(descriptor.backendId);
		expect(renamed.namespaceId).toBe(descriptor.namespaceId);
		expect(renamed.serviceUid).toBe(descriptor.serviceUid);
		const moved = f.registry.save({ ...profile, host: "replacement-mini" });
		expect(moved.backendId).toBeUndefined();
		f.manager.dispose();
		f.registry.close();
	});

	test("wrong service identity closes the tunnel instead of publishing readiness", async () => {
		const f = fixture({
			describe: { ...descriptor, backendId: "different-machine" },
		});
		await expect(f.manager.connect("mac")).rejects.toThrow("identity");
		expect(f.manager.getLease("mac")).toBeNull();
		expect(f.closed()).toBe(1);
		f.registry.close();
	});

	test("tunnel exit revokes lease before another request can use a reused port", async () => {
		const f = fixture();
		await f.manager.connect("mac");
		f.exit();
		expect(f.manager.getLease("mac")).toBeNull();
		await expect(
			f.manager.invoke("mac", { path: "project.list", type: "query" }),
		).rejects.toThrow("connected");
		expect(f.requests).toHaveLength(1);
		f.registry.close();
	});

	test("disconnect during forwarding cannot publish a stale connection", async () => {
		let ready: (value: { url: string; close: () => void }) => void = () => {};
		let entered: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let closed = 0;
		const f = fixture({
			forward: async () => {
				entered();
				return new Promise((resolve) => {
					ready = resolve;
				});
			},
		});
		const pending = f.manager.connect("mac");
		await started;
		f.manager.disconnect("mac");
		ready({
			url: "http://127.0.0.1:12345",
			close: () => {
				closed++;
			},
		});
		await expect(pending).rejects.toThrow("cancelled");
		expect(f.manager.getLease("mac")).toBeNull();
		expect(closed).toBe(1);
		f.registry.close();
	});

	test("concurrent windows share one connection attempt", async () => {
		let forwards = 0;
		const f = fixture({
			forward: async () => {
				forwards++;
				return { url: "http://127.0.0.1:12345", close: () => {} };
			},
		});
		const [a, b] = await Promise.all([
			f.manager.connect("mac"),
			f.manager.connect("mac"),
		]);
		expect(a.generation).toBe(b.generation);
		expect(forwards).toBe(1);
		f.manager.dispose();
		f.registry.close();
	});

	test("raw transport rejects absolute URLs and cannot replace main-process credentials", async () => {
		const f = fixture();
		await f.manager.connect("mac");
		await expect(
			f.manager.request("mac", {
				path: "http://evil.test/",
				headers: { Authorization: "evil" },
			}),
		).rejects.toThrow();
		await expect(
			f.manager.request("mac", {
				path: "/direct/describe",
				headers: { Authorization: "evil" },
			}),
		).rejects.toThrow();
		expect(f.requests).toHaveLength(1);
		f.manager.dispose();
		f.registry.close();
	});

	test("editing the SSH destination invalidates the old connection before RPC", async () => {
		const f = fixture();
		await f.manager.connect("mac");
		f.registry.save({ ...profile, host: "replacement-mini" });
		await expect(
			f.manager.invoke("mac", { path: "project.list", type: "query" }),
		).rejects.toThrow("changed");
		expect(f.manager.getLease("mac")).toBeNull();
		expect(f.requests).toHaveLength(1);
		f.registry.close();
	});

	test("URL normalization cannot turn control characters into an external socket origin", async () => {
		const f = fixture();
		await f.manager.connect("mac");
		await expect(
			f.manager.request("mac", { path: "/\t/evil.test/socket" }),
		).rejects.toThrow("path");
		expect(() => f.manager.openSocket("mac", "/\t/evil.test/socket")).toThrow(
			"path",
		);
		f.manager.dispose();
		f.registry.close();
	});
});

describe("connection configuration", () => {
	test("private master disables inherited forwards and only its control command adds loopback", () => {
		const master = masterArguments(profile, "/tmp/owned/control");
		expect(master).toContain("ClearAllForwardings=yes");
		expect(master).toContain("ControlMaster=yes");
		expect(master).toContain("ControlPath=/tmp/owned/control");
		const forward = forwardArguments(
			profile.host,
			"/tmp/owned/control",
			"/tmp/owned/empty",
			32345,
			44321,
		);
		expect(forward).toContain("/tmp/owned/empty");
		expect(forward).toContain("forward");
		expect(forward).toContain("127.0.0.1:32345:127.0.0.1:44321");
		expect(forward).not.toContain("ClearAllForwardings=no");
	});
	test("registry is SQLite backed and rejects credential fields or SSH option injection", () => {
		const db = new Database(":memory:");
		const registry = new ConnectionRegistry(db);
		expect(() =>
			registry.save({ ...profile, host: "-oProxyCommand=evil" }),
		).toThrow();
		expect(() => registry.save({ ...profile, password: "secret" })).toThrow();
		registry.save(profile);
		expect(registry.list()).toHaveLength(1);
		registry.remove("mac");
		expect(registry.list()).toHaveLength(0);
		registry.close();
	});
	test("SSH honors config but overrides unsafe tunnel and agent forwarding options", () => {
		const args = sshArguments({
			...profile,
			port: 2222,
			user: "alice",
			identityFile: "/safe/key",
		});
		expect(args).toContain("StrictHostKeyChecking=yes");
		expect(args).toContain("ControlMaster=no");
		expect(args).toContain("ControlPath=none");
		expect(args).toContain("ForwardAgent=no");
		expect(args).toContain("BatchMode=yes");
		expect(args).toContain("RemoteCommand=none");
		expect(args).toContain("SessionType=default");
		expect(args.at(-1)).toBe("mini");
	});
});
