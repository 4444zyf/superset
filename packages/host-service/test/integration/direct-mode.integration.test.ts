import { expect, test } from "bun:test";
import { dirname } from "node:path";
import { writeAttachment } from "../../src/trpc/router/attachments/storage";
import { createTestHost } from "../helpers/createTestHost";
import { createGitFixture } from "../helpers/git-fixture";

test("direct mode authenticates local clients without constructing a cloud API", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		expect(host.api).toBeNull();
		expect(await host.trpc.direct.describe.query()).toMatchObject({
			runtimeMode: "direct",
			protocolVersion: 1,
			cloudAccountRequired: false,
		});
		await expect(host.unauthenticatedTrpc.direct.describe.query()).rejects.toMatchObject({
			data: { code: "UNAUTHORIZED" },
		});
		expect(host.apiCalls).toEqual([]);
	} finally {
		await host.dispose();
	}
});

test("direct project creation returns one stable project across response-loss retries", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		const operation = { operationId: "00000000-0000-4000-8000-000000000003", procedure: "project.create" as const, input: { name: "Direct example", mode: { kind: "empty", parentDir: dirname(host.dbPath) } } };
		const first = await host.trpc.direct.execute.mutate(operation);
		const retry = await host.trpc.direct.execute.mutate(operation);
		expect(first).toMatchObject({ status: "completed", result: { projectId: operation.operationId } });
		expect(retry).toEqual(first);
		expect(host.db.query.projects.findMany().sync()).toHaveLength(1);
		expect(await host.trpc.direct.operationStatus.query({ operationId: operation.operationId })).toEqual(first);
		expect(host.apiCalls).toEqual([]);
	} finally { await host.dispose(); }
});

test("an explicit project ID cannot rebind an existing project to another repository", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	const firstRepo = await createGitFixture();
	const secondRepo = await createGitFixture();
	try {
		const id = "00000000-0000-4000-8000-000000000010";
		await host.trpc.project.create.mutate({ id, name: "First", mode: { kind: "importLocal", repoPath: firstRepo.repoPath } });
		await expect(host.trpc.project.create.mutate({ id, name: "Second", mode: { kind: "importLocal", repoPath: secondRepo.repoPath } })).rejects.toMatchObject({ data: { code: "CONFLICT" } });
		expect(await host.trpc.project.get.query({ projectId: id })).toMatchObject({ repoPath: firstRepo.repoPath, name: "First" });
		expect(await host.trpc.project.create.mutate({ name: "Same path", mode: { kind: "importLocal", repoPath: firstRepo.repoPath } })).toMatchObject({ projectId: id, created: false });
	} finally { await host.dispose(); firstRepo.dispose(); secondRepo.dispose(); }
});

test("a drain blocks new requests across clients while reads and completed retries remain available", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		const ownerId = "00000000-0000-4000-8000-000000000004";
		expect(await host.trpc.direct.beginDrain.mutate({ ownerId })).toMatchObject({ mode: "draining", safeToRestart: true });
		await expect(host.trpc.project.create.mutate({ name: "Blocked", mode: { kind: "empty", parentDir: dirname(host.dbPath) } })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
		const operationId = "00000000-0000-4000-8000-000000000005";
		await expect(host.trpc.direct.execute.mutate({ operationId, procedure: "project.create", input: { name: "Blocked", mode: { kind: "empty", parentDir: dirname(host.dbPath) } } })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
		expect(await host.trpc.direct.operationStatus.query({ operationId })).toBeNull();
		expect(await host.trpc.health.check.query()).toMatchObject({ status: "ok" });
		const response = await host.fetch("http://host-service.test/direct/end-drain", { method: "POST", headers: { authorization: `Bearer ${host.psk}`, "content-type": "application/json" }, body: JSON.stringify({ ownerId }) });
		expect(response.status).toBe(200);
		expect(await host.trpc.direct.maintenanceStatus.query()).toMatchObject({ mode: "active" });
	} finally { await host.dispose(); }
});

test("direct attachments download from the remote namespace over an authenticated request", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		const attachmentId = "00000000-0000-4000-8000-000000000006";
		writeAttachment(Buffer.from("remote content"), { attachmentId, mediaType: "text/plain", originalFilename: "example.txt", sizeBytes: 14, createdAt: Date.now() }, dirname(host.dbPath));
		expect((await host.fetch(`http://host-service.test/attachments/${attachmentId}`)).status).toBe(401);
		const response = await host.fetch(`http://host-service.test/attachments/${attachmentId}`, { headers: { authorization: `Bearer ${host.psk}` } });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("remote content");
		expect((await host.fetch("http://host-service.test/attachments/not-a-uuid", { headers: { authorization: `Bearer ${host.psk}` } })).status).toBe(400);
	} finally { await host.dispose(); }
});

test("a maintenance drain rejects the raw terminal creation route before it can launch work", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		await host.trpc.direct.beginDrain.mutate({ ownerId: "00000000-0000-4000-8000-000000000007" });
		const response = await host.fetch("http://host-service.test/terminal/sessions", { method: "POST", headers: { authorization: `Bearer ${host.psk}`, "content-type": "application/json" }, body: JSON.stringify({ terminalId: "terminal", workspaceId: "missing-workspace" }) });
		expect(response.status).toBe(409);
	} finally { await host.dispose(); }
});

test("a frozen backend blocks metadata, files, Git, and raw writes while maintenance remains available", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		const ownerId = "00000000-0000-4000-8000-000000000008";
		expect(await host.trpc.direct.beginDrain.mutate({ ownerId, freeze: true })).toMatchObject({ frozen: true, safeToRestart: true });
		await expect(host.trpc.project.update.mutate({ projectId: "00000000-0000-4000-8000-000000000009", name: "Blocked" })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
		await expect(host.trpc.filesystem.createDirectory.mutate({ workspaceId: "missing-workspace", absolutePath: "/blocked" })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
		await expect(host.trpc.git.stageAll.mutate({ workspaceId: "missing-workspace" })).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
		expect((await host.fetch("http://host-service.test/terminal/sessions", { method: "POST", headers: { authorization: `Bearer ${host.psk}` }, body: "{}" })).status).toBe(503);
		expect((await host.fetch("http://host-service.test/chat-v3/trpc/prompt", { method: "POST", headers: { authorization: `Bearer ${host.psk}` }, body: "{}" })).status).toBe(503);
		expect(await host.trpc.direct.maintenanceStatus.query()).toMatchObject({ frozen: true });
		expect(await host.trpc.direct.endDrain.mutate({ ownerId })).toMatchObject({ frozen: false });
	} finally { await host.dispose(); }
});

test("direct cloud-only capabilities fail explicitly and never reach an official API", async () => {
	const host = await createTestHost({ runtimeMode: "direct" });
	try {
		await expect(host.trpc.host.info.query()).rejects.toMatchObject({
			data: { code: "PRECONDITION_FAILED" },
		});
		await expect(host.trpc.pageWatch.getAll.query()).rejects.toMatchObject({
			data: { code: "PRECONDITION_FAILED" },
		});
		expect(host.apiCalls).toEqual([]);
	} finally {
		await host.dispose();
	}
});

test("direct HTTP endpoints require a PSK and reject an untrusted browser origin", async () => {
	const host = await createTestHost({ runtimeMode: "direct", allowedOrigins: ["http://trusted.test"] });
	try {
		expect((await host.fetch("http://host-service.test/direct/describe")).status).toBe(401);
		expect((await host.fetch(`http://host-service.test/direct/describe?token=${host.psk}`)).status).toBe(401);
		const response = await host.fetch("http://host-service.test/direct/describe", { headers: { authorization: `Bearer ${host.psk}` } });
		expect(await response.json()).toMatchObject({ runtimeMode: "direct", serviceUid: process.getuid?.() ?? 0, instanceId: "test-instance" });
		expect((await host.fetch("http://host-service.test/direct/describe", { headers: { authorization: `Bearer ${host.psk}`, origin: "http://untrusted.test" } })).status).toBe(403);
		await expect(host.unauthenticatedTrpc.health.check.query()).rejects.toThrow();
	} finally {
		await host.dispose();
	}
});
