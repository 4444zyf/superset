import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { readFromDirectNamespace } from "./readFromDirectNamespace";
import { resolveDirectNamespace } from "./resolveDirectNamespace";

const roots: string[] = [],
	servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0))
		await new Promise<void>((resolve) => server.close(() => resolve()));
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
async function fixture() {
	const homeDir = mkdtempSync(join(tmpdir(), "remix-cli-namespace-"));
	roots.push(homeDir);
	for (const name of ["state", "credentials"])
		mkdirSync(join(homeDir, name), { mode: 0o700 });
	const config = {
		backendId: crypto.randomUUID(),
		namespaceId: crypto.randomUUID(),
		homeDir,
		secretFile: join(homeDir, "credentials/host-secret"),
		migrationsFolder: join(homeDir, "migrations"),
		allowedOrigins: [],
		installationMode: "local",
	};
	const endpoint = {
		backendId: config.backendId,
		namespaceId: config.namespaceId,
		instanceId: "cli-instance",
		serviceUid: process.getuid!(),
		runtimeMode: "direct",
		protocolVersion: 1,
		port: 54321,
		socketPath: directBackendSocketPath({ ...config, uid: process.getuid!() }),
	};
	const socketDir = join(endpoint.socketPath, "..");
	mkdirSync(socketDir, { mode: 0o700, recursive: true });
	roots.push(socketDir);
	const write = (path: string, value: string) =>
		writeFileSync(join(homeDir, path), value, { mode: 0o600 });
	write("service-config.json", JSON.stringify(config));
	write(
		"identity.json",
		JSON.stringify({
			backendId: config.backendId,
			namespaceId: config.namespaceId,
		}),
	);
	write("credentials/host-secret", "a".repeat(64));
	write("state/endpoint.json", JSON.stringify(endpoint));
	const requests: Array<{ path: string; authenticated: boolean }> = [];
	let description = {
		...endpoint,
		cloudAccountRequired: false,
		capabilities: {
			projects: true,
			sessions: true,
			terminals: true,
			workstationAgentCatalogReadV1: true,
			workstationTerminalScriptsV1: true,
		},
	};
	const server = createServer((request, response) => {
		requests.push({
			path: request.url ?? "",
			authenticated:
				request.headers.authorization === `Bearer ${"a".repeat(64)}`,
		});
		response.setHeader("Content-Type", "application/json");
		if (!requests.at(-1)!.authenticated) {
			response.writeHead(401);
			response.end("{}");
			return;
		}
		if (request.url === "/direct/describe") {
			response.end(JSON.stringify(description));
			return;
		}
		response.end(
			JSON.stringify([
				{
					result: {
						data: { json: [{ id: "project", name: "Only this namespace" }] },
					},
				},
			]),
		);
	});
	servers.push(server);
	await new Promise<void>((resolve) =>
		server.listen(endpoint.socketPath, resolve),
	);
	chmodSync(endpoint.socketPath, 0o600);
	return {
		homeDir,
		config,
		endpoint,
		requests,
		write,
		setDescription: (value: Partial<typeof description>) => {
			description = { ...description, ...value };
		},
	};
}

test("an explicit namespace authenticates and reads through its owned Unix socket", async () => {
	const f = await fixture(),
		target = await resolveDirectNamespace(f.homeDir);
	expect(target.description.namespaceId).toBe(f.config.namespaceId);
	expect(
		(await target.client.project.list.query()).map(({ id, name }) => ({
			id,
			name,
		})),
	).toEqual([{ id: "project", name: "Only this namespace" }]);
	expect(f.requests.every((r) => r.authenticated)).toBe(true);
	expect(f.requests[1]?.path.startsWith("/trpc/project.list")).toBe(true);
});

test("read-only namespace access refuses both mutations and the legacy Agent query that can seed defaults", async () => {
	const f = await fixture(),
		target = await resolveDirectNamespace(f.homeDir);
	await expect(
		target.client.settings.agentConfigs.list.query(),
	).rejects.toThrow("read-only");
	await expect(
		target.client.project.update.mutate({} as never),
	).rejects.toThrow("read-only");
	expect(f.requests.map((r) => r.path)).toEqual(["/direct/describe"]);
});

test("a stopped or absent namespace is never created or started", async () => {
	const f = await fixture();
	f.write("state/disabled", "stopped");
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow("stopped");
	expect(f.requests).toEqual([]);
	const missing = join(f.homeDir, "missing");
	await expect(resolveDirectNamespace(missing)).rejects.toThrow();
	expect(existsSync(missing)).toBe(false);
});

test("foreign endpoint identity and a mismatched authenticated description are refused", async () => {
	const f = await fixture();
	f.write(
		"state/endpoint.json",
		JSON.stringify({ ...f.endpoint, namespaceId: crypto.randomUUID() }),
	);
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow("identity");
	expect(f.requests).toEqual([]);
	f.write("state/endpoint.json", JSON.stringify(f.endpoint));
	f.setDescription({ instanceId: "replaced-instance" });
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow("identity");
});

test("a query cannot silently cross to a replacement endpoint after verification", async () => {
	const f = await fixture(),
		target = await resolveDirectNamespace(f.homeDir);
	f.write(
		"state/endpoint.json",
		JSON.stringify({ ...f.endpoint, instanceId: "new-instance" }),
	);
	await expect(target.client.project.list.query()).rejects.toThrow("changed");
	expect(f.requests).toHaveLength(1);
});

test("a missing read capability is rejected before sending a procedure to an older backend", async () => {
	const f = await fixture();
	f.setDescription({ capabilities: {} as never });
	const target = await resolveDirectNamespace(f.homeDir);
	await expect(target.client.project.list.query()).rejects.toThrow(
		"capability",
	);
	expect(f.requests).toHaveLength(1);
});

test("namespace secrets must remain private regular files", async () => {
	const f = await fixture();
	chmodSync(f.config.secretFile, 0o644);
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow();
	expect(f.requests).toEqual([]);
	chmodSync(f.config.secretFile, 0o600);
	const alternate = join(f.homeDir, "alternate");
	writeFileSync(alternate, "a".repeat(64), { mode: 0o600 });
	unlinkSync(f.config.secretFile);
	symlinkSync(alternate, f.config.secretFile);
	await expect(resolveDirectNamespace(f.homeDir)).rejects.toThrow();
	expect(f.requests).toEqual([]);
});

test("an absent namespace keeps the old command branch and conflicting targets never read credentials", async () => {
	const f = await fixture();
	let entered = false;
	expect(
		await readFromDirectNamespace({}, async () => {
			entered = true;
			return [];
		}),
	).toBeNull();
	await expect(
		readFromDirectNamespace(
			{ namespace: f.homeDir, host: "other" },
			async () => {
				entered = true;
				return [];
			},
		),
	).rejects.toThrow("either --namespace or --host");
	expect(entered).toBe(false);
	expect(f.requests).toEqual([]);
});
