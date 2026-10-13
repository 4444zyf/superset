import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { DirectConnectionManager } from "./manager.ts";
import { ConnectionRegistry } from "./registry.ts";
import { OpenSshRuntime } from "./ssh.ts";
import { createSshFixture } from "./ssh-fixture.ts";
import { createShapedSshFixture } from "./ssh-shaped-fixture.ts";

const output = process.argv[2];
if (!output) throw new Error("An output file is required");
const results: unknown[] = [];
for (const rtt of [0, 50, 150]) {
	const fixture = rtt
		? await createShapedSshFixture(rtt, rtt === 150 ? 5 : 20, {
				isolateHome: true,
			})
		: await createSshFixture({ isolateHome: true });
	const backendId = randomUUID();
	const namespaceId = randomUUID();
	const socketPath = directBackendSocketPath({
		homeDir: join(fixture.homeDir, ".superset-direct"),
		backendId,
		namespaceId,
		uid: process.getuid?.() ?? 0,
	});
	const descriptor = {
		backendId,
		namespaceId,
		instanceId: randomUUID(),
		socketPath,
		port: 45221,
		serviceUid: process.getuid?.(),
		protocolVersion: 1,
		runtimeMode: "direct",
		capabilities: { projects: true, sessions: true },
	};
	const secret = randomBytes(32).toString("hex");
	await mkdir(join(socketPath, ".."), { recursive: true, mode: 0o700 });
	await mkdir(join(fixture.homeDir, ".superset-direct/state"), {
		recursive: true,
		mode: 0o700,
	});
	await mkdir(join(fixture.homeDir, ".superset-direct/credentials"), {
		recursive: true,
		mode: 0o700,
	});
	await writeFile(
		join(fixture.homeDir, ".superset-direct/state/endpoint.json"),
		JSON.stringify(descriptor),
		{ mode: 0o600 },
	);
	await writeFile(
		join(fixture.homeDir, ".superset-direct/credentials/host-secret"),
		secret,
		{ mode: 0o600 },
	);
	const server = createServer((request, response) => {
		if (request.headers.authorization !== `Bearer ${secret}`) {
			response.writeHead(401).end();
			return;
		}
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify(
				request.url?.startsWith("/trpc/")
					? { result: { data: { json: [] } } }
					: descriptor,
			),
		);
	});
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	try {
		for (const shared of [false, true]) {
			const registry = new ConnectionRegistry(new Database(":memory:"));
			registry.save(fixture.profile);
			const runtime = new OpenSshRuntime({
				configFile: fixture.configFile,
				reuseConnections: shared,
			});
			const manager = new DirectConnectionManager({ registry, runtime });
			const authenticated: number[] = [];
			const lists: number[] = [];
			const reuse: number[] = [];
			const initialConnections = fixture.stats().authenticatedConnections;
			try {
				for (let sample = 0; sample < 30; sample++) {
					manager.disconnect(fixture.profile.id);
					const start = performance.now();
					const lease = await manager.connect(fixture.profile.id);
					authenticated.push(performance.now() - start);
					assert.equal(lease.instanceId, descriptor.instanceId);
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
					lists.push(performance.now() - start);
					const again = performance.now();
					assert.deepEqual(await manager.connect(fixture.profile.id), lease);
					reuse.push(performance.now() - again);
				}
				const result = {
					rttMs: rtt,
					mode: shared ? "shared-master" : "independent-command-and-forward",
					authenticatedMs: authenticated,
					workspaceReadyMs: lists,
					reuseMs: reuse,
					networkAuthentications:
						fixture.stats().authenticatedConnections - initialConnections,
				};
				results.push(result);
				console.log(JSON.stringify(result));
			} finally {
				manager.dispose();
				registry.close();
			}
		}
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await fixture.close();
	}
}
await writeFile(
	output,
	JSON.stringify(
		{
			backend:
				"synthetic HTTP backend on private Unix socket; actual OpenSSH, authenticated manager and RPC transport",
			network: "loopback or application-level TCP delay/rate relay",
			samples: 30,
			results,
		},
		null,
		2,
	),
);
