import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatRuntime } from "@superset/chat-runtime";
import { createBunChatDb } from "../../../chat-runtime/src/testing/testRuntime/testRuntime";
import {
	FAKE_HARNESS,
	fakeHarnessRegistry,
} from "../../../chat-runtime/src/testing/testUtils/testUtils";
import { DirectOperationStore } from "./operations";

test("direct chat command receipts survive runtime restart and do not relaunch or redeliver a prompt", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "direct-chat-durable-"));
	const db = new Database(":memory:");
	const { harnesses, adapters } = fakeHarnessRegistry({ turns: [[]] });
	const build = (instanceId: string) => {
		const operations = new DirectOperationStore(db, instanceId);
		return createChatRuntime({
			dataDir,
			openDatabase: createBunChatDb,
			harnesses,
			commandDedupe: {
				run: (id, execute, input) => operations.runCommand(id, input, execute),
			},
		});
	};
	let runtime = build("first");
	try {
		const createInput = {
			commandId: randomUUID(),
			scopeId: "workspace",
			harness: FAKE_HARNESS,
			cwd: dataDir,
		};
		const created = runtime.commands.createSession(createInput);
		const promptInput = {
			commandId: randomUUID(),
			sessionId: created.sessionId,
			clientId: "client",
			content: [{ type: "text" as const, text: "once" }],
		};
		const prompted = runtime.commands.prompt(promptInput);
		await runtime.dispose();
		runtime = build("second");
		expect(runtime.commands.createSession(createInput)).toEqual(created);
		expect(runtime.commands.prompt(promptInput)).toEqual(prompted);
		expect(adapters).toHaveLength(1);
		expect(runtime.commands.listSessions({})).toHaveLength(1);
		expect(() =>
			runtime.commands.prompt({
				...promptInput,
				content: [{ type: "text", text: "changed" }],
			}),
		).toThrow("different inputs");
	} finally {
		await runtime.dispose();
		db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});

test("a synchronous chat command interrupted after an effect remains unresolved across restart", () => {
	const db = new Database(":memory:");
	try {
		let effects = 0;
		const first = new DirectOperationStore(db, "first");
		expect(() =>
			first.runCommand("prompt:command", { sessionId: "session" }, () => {
				effects++;
				throw new Error("lost after delivery");
			}),
		).toThrow("lost after delivery");
		const second = new DirectOperationStore(db, "second");
		expect(() =>
			second.runCommand("prompt:command", { sessionId: "session" }, () => {
				effects++;
			}),
		).toThrow("unresolved");
		expect(effects).toBe(1);
	} finally {
		db.close();
	}
});
