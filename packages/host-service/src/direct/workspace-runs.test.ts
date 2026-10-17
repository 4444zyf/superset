import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { OperationDatabase } from "./operations";
import { WorkspaceRunManager, WorkspaceRunStore } from "./workspace-runs";
const run = {
	workspaceId: "workspace",
	operationId: "operation",
	terminalId: "terminal",
	commands: ["echo run"],
	startedAt: 1,
};

test("an active run survives manager replacement and blocks a second operation", async () => {
	const db = new Database(":memory:");
	const store = new WorkspaceRunStore(db as unknown as OperationDatabase);
	let launches = 0;
	const deps = {
		launch: async () => {
			launches++;
		},
		probe: async () => ({
			state: "live" as const,
			executionId: "execution",
			foreground: true,
		}),
		signal: async () => {},
	};
	await new WorkspaceRunManager(store, deps).start(run);
	const restored = new WorkspaceRunManager(
		new WorkspaceRunStore(db as unknown as OperationDatabase),
		deps,
	);
	await expect(
		restored.start({ ...run, operationId: "second", terminalId: "second" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(launches).toBe(1);
	expect((await restored.read("workspace"))?.executionId).toBe("execution");
});

test("an uncertain launch remains blocked rather than retrying the command", async () => {
	const store = new WorkspaceRunStore(
		new Database(":memory:") as unknown as OperationDatabase,
	);
	let launches = 0;
	const manager = new WorkspaceRunManager(store, {
		launch: async () => {
			launches++;
			throw new Error("Reply lost");
		},
		probe: async () => ({ state: "unknown" as const }),
		signal: async () => {},
	});
	await expect(manager.start(run)).rejects.toThrow("Reply lost");
	await expect(
		manager.start({ ...run, operationId: "second" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect((await manager.read("workspace"))?.state).toBe("unknown");
	expect(launches).toBe(1);
});

test("a stop request with unknown foreground state cannot authorize another launch", async () => {
	const store = new WorkspaceRunStore(
		new Database(":memory:") as unknown as OperationDatabase,
	);
	let foreground: boolean | null = true;
	const manager = new WorkspaceRunManager(store, {
		launch: async () => {},
		probe: async () => ({
			state: "live" as const,
			executionId: "execution",
			foreground,
		}),
		signal: async () => {
			foreground = null;
		},
	});
	await manager.start(run);
	await manager.stop("workspace", "operation", "execution", false);
	expect((await manager.read("workspace"))?.state).toBe("stop-requested");
	await expect(
		manager.start({ ...run, operationId: "second" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
	foreground = false;
	expect((await manager.read("workspace"))?.state).toBe("ended");
});

test("a changed execution is never signalled by a stale stop request", async () => {
	const store = new WorkspaceRunStore(
		new Database(":memory:") as unknown as OperationDatabase,
	);
	let executionId = "execution",
		signals = 0;
	const manager = new WorkspaceRunManager(store, {
		launch: async () => {},
		probe: async () => ({
			state: "live" as const,
			executionId,
			foreground: true,
		}),
		signal: async () => {
			signals++;
		},
	});
	await manager.start(run);
	executionId = "replacement";
	await expect(
		manager.stop("workspace", "operation", "execution", true),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(signals).toBe(0);
});

test("a status read during launch cannot prevent its confirmed execution becoming active", async () => {
	const store = new WorkspaceRunStore(
		new Database(":memory:") as unknown as OperationDatabase,
	);
	let finish!: () => void;
	const manager = new WorkspaceRunManager(store, {
		launch: async () =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		probe: async () => ({
			state: "live" as const,
			executionId: "execution",
			foreground: true,
		}),
		signal: async () => {},
	});
	const pending = manager.start(run);
	await Promise.resolve();
	await Promise.resolve();
	expect((await manager.read("workspace"))?.state).toBe("unknown");
	finish();
	expect((await pending).state).toBe("active");
});

test("the next confirmed run retains the preceding terminal identity for pane reuse", async () => {
	const store = new WorkspaceRunStore(
		new Database(":memory:") as unknown as OperationDatabase,
	);
	const manager = new WorkspaceRunManager(store, {
		launch: async () => {},
		probe: async () => ({
			state: "live" as const,
			executionId: "execution",
			foreground: true,
		}),
		signal: async () => {},
	});
	const first = await manager.start(run);
	store.update(first, { state: "ended" });
	const second = await manager.start({
		...run,
		operationId: "next",
		terminalId: "next-terminal",
	});
	expect(second.previousTerminalId).toBe("terminal");
});

test("an instant command with a completion result ends even when foreground was never observed", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceRunStore(db as unknown as OperationDatabase);
		let launches = 0;
		const runtime = {
			launch: async () => {
				launches++;
			},
			probe: async () => ({
				state: "live" as const,
				executionId: "execution",
				foreground: false,
				exitCode: 17,
			}),
			signal: async () => {},
		};
		const first = await new WorkspaceRunManager(store, runtime).start({
			...run,
			completionTracked: true,
		});
		expect(first).toMatchObject({
			state: "ended",
			executionId: "execution",
			exitCode: 17,
			foregroundSeen: false,
		});
		expect(
			await new WorkspaceRunManager(store, runtime).read("workspace"),
		).toMatchObject({ state: "ended", exitCode: 17 });
		expect(launches).toBe(1);
	} finally {
		db.close();
	}
});
test("an idle shell without its tracked completion cannot release a run for another launch", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceRunStore(db as unknown as OperationDatabase);
		let foreground = true;
		const manager = new WorkspaceRunManager(store, {
			launch: async () => {},
			probe: async () => ({
				state: "live" as const,
				executionId: "execution",
				foreground,
			}),
			signal: async () => {},
		});
		await manager.start({ ...run, completionTracked: true });
		foreground = false;
		expect((await manager.read("workspace"))?.state).toBe("active");
		await expect(
			manager.start({ ...run, operationId: "second" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	} finally {
		db.close();
	}
});

test("workspace deletion releases its bounded run slot without removing another workspace", () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceRunStore(db as unknown as OperationDatabase, 1);
		store.reserve(run);
		store.remove("other");
		expect(() => store.reserve({ ...run, workspaceId: "next" })).toThrow(
			"full",
		);
		store.remove(run.workspaceId);
		expect(store.reserve({ ...run, workspaceId: "next" })).toMatchObject({
			workspaceId: "next",
			state: "starting",
		});
	} finally {
		db.close();
	}
});

test("a stop arriving after completion does not signal an idle or reused console", async () => {
	const db = new Database(":memory:");
	try {
		const store = new WorkspaceRunStore(db as unknown as OperationDatabase);
		let exitCode: number | undefined;
		let signals = 0;
		const manager = new WorkspaceRunManager(store, {
			launch: async () => {},
			probe: async () => ({
				state: "live" as const,
				executionId: "execution",
				foreground: exitCode === undefined,
				exitCode,
			}),
			signal: async () => {
				signals++;
			},
		});
		await manager.start({ ...run, completionTracked: true });
		exitCode = 0;
		expect(
			await manager.stop("workspace", "operation", "execution", false),
		).toMatchObject({ state: "ended", exitCode: 0 });
		expect(signals).toBe(0);
	} finally {
		db.close();
	}
});
