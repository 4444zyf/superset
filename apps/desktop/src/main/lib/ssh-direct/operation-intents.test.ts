import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { SqliteDatabase } from "@superset/direct-connection";
import { OperationIntents } from "./operation-intents";

test("an unanswered mutation blocks a fresh operation even after reopening the journal", () => {
	const db = new Database(":memory:");
	const first = new OperationIntents(db as unknown as SqliteDatabase);
	first.begin({
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		operationId: "operation",
		procedure: "chat.prompt",
		inputHash: "digest",
	});
	const restarted = new OperationIntents(db as unknown as SqliteDatabase);
	expect(() =>
		restarted.begin({
			connectionId: "machine",
			backendId: "backend",
			namespaceId: "namespace",
			operationId: "different",
			procedure: "chat.prompt",
			inputHash: "digest",
		}),
	).toThrow("Reconcile");
	expect(restarted.list("machine")).toHaveLength(1);
	db.close();
});

test("an operation cannot be moved to a different backend or changed input", () => {
	const db = new Database(":memory:");
	const journal = new OperationIntents(db as unknown as SqliteDatabase);
	const operation = {
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		operationId: "operation",
		procedure: "project.create",
		inputHash: "digest",
	};
	journal.begin(operation);
	expect(() => journal.begin({ ...operation, inputHash: "changed" })).toThrow(
		"Operation identity",
	);
	expect(() => journal.begin({ ...operation, backendId: "other" })).toThrow(
		"Operation identity",
	);
	db.close();
});

test("reconciliation clears a resolved operation and the journal stores no prompt or secret", () => {
	const db = new Database(":memory:");
	const journal = new OperationIntents(db as unknown as SqliteDatabase);
	journal.begin({
		connectionId: "machine",
		backendId: "backend",
		namespaceId: "namespace",
		operationId: "operation",
		procedure: "chat.prompt",
		inputHash: "digest",
	});
	expect(Object.keys(journal.list("machine")[0])).toEqual([
		"connectionId",
		"backendId",
		"namespaceId",
		"operationId",
		"procedure",
		"inputHash",
	]);
	journal.resolve("machine", "operation");
	expect(journal.list("machine")).toEqual([]);
	db.close();
});
