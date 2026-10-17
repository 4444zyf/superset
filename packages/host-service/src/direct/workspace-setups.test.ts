import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
	WorkspaceSetupStore,
	readWorkspaceSetupStatus,
} from "./workspace-setups";
const input = {
	workspaceId: "workspace",
	terminalId: "terminal",
	startedAt: 1,
	completionTracked: true,
};
test("a setup completion is retained across host replacement without launching anything", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceSetupStore(db);
		store.begin(input);
		const result = await readWorkspaceSetupStatus(
			store,
			"workspace",
			async () => ({ state: "live", executionId: "execution", exitCode: 17 }),
		);
		expect(result).toMatchObject({
			phase: "failed",
			exitCode: 17,
			terminalId: "terminal",
			executionId: "execution",
		});
		let reads = 0;
		expect(
			await readWorkspaceSetupStatus(
				new WorkspaceSetupStore(db),
				"workspace",
				async () => {
					reads++;
					return { state: "unknown" };
				},
			),
		).toMatchObject({ phase: "failed", exitCode: 17 });
		expect(reads).toBe(0);
	} finally {
		db.close();
	}
});
test("a replaced terminal execution cannot complete the original setup", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceSetupStore(db);
		const setup = store.begin(input);
		store.update(setup, { phase: "running", executionId: "original" });
		expect(
			await readWorkspaceSetupStatus(store, "workspace", async () => ({
				state: "live",
				executionId: "replacement",
				exitCode: 0,
			})),
		).toMatchObject({ phase: "unknown", executionId: "original" });
	} finally {
		db.close();
	}
});
test("late launch warnings cannot overwrite a newer setup and deletion releases its bounded slot", () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceSetupStore(db, 1);
		const old = store.begin(input);
		const current = store.begin({ ...input, terminalId: "new" });
		store.update(old, { phase: "failed", warning: "old launch failed" });
		expect(store.get("workspace")).toEqual(current);
		expect(() => store.begin({ ...input, workspaceId: "other" })).toThrow(
			"full",
		);
		store.remove("workspace");
		expect(store.begin({ ...input, workspaceId: "other" })).toMatchObject({
			phase: "launching",
			workspaceId: "other",
		});
	} finally {
		db.close();
	}
});
test("a known setup terminal launch failure remains visible without a terminal or retry", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceSetupStore(db);
		const setup = store.begin(input);
		store.update(setup, {
			phase: "failed",
			warning: "Failed to start setup terminal: unavailable",
		});
		expect(
			await readWorkspaceSetupStatus(store, "workspace", async () => {
				throw new Error("must not probe or launch");
			}),
		).toMatchObject({
			phase: "failed",
			warning: "Failed to start setup terminal: unavailable",
		});
	} finally {
		db.close();
	}
});

test("an uncertain setup recovers the same terminal result instead of running a second script", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceSetupStore(db);
		const setup = store.begin(input);
		store.update(setup, { phase: "unknown", warning: "Daemon unavailable" });
		expect(
			await readWorkspaceSetupStatus(store, "workspace", async () => ({
				state: "live",
				executionId: "execution",
				exitCode: 0,
			})),
		).toMatchObject({
			phase: "succeeded",
			terminalId: "terminal",
			exitCode: 0,
		});
		expect(store.get("workspace")?.warning).toBeUndefined();
	} finally {
		db.close();
	}
});
