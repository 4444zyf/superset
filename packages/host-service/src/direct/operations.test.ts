import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { DirectOperationStore } from "./operations";

test("a completed direct command is returned after backend restart without repeating side effects", async () => {
	const db = new Database(":memory:");
	try {
		let executions = 0;
		const first = new DirectOperationStore(db, "generation-a");
		await first.execute(
			"operation",
			"project.create",
			{ name: "Example" },
			async () => {
				executions++;
				return { projectId: "project" };
			},
		);
		const second = new DirectOperationStore(db, "generation-b");
		expect(
			await second.execute(
				"operation",
				"project.create",
				{ name: "Example" },
				async () => {
					executions++;
					return {};
				},
			),
		).toMatchObject({ status: "completed", result: { projectId: "project" } });
		expect(executions).toBe(1);
	} finally {
		db.close();
	}
});

test("an operation ID cannot be reused for different inputs", async () => {
	const db = new Database(":memory:");
	try {
		const store = new DirectOperationStore(db, "generation");
		await store.execute(
			"operation",
			"chat.prompt",
			{ text: "first" },
			() => "accepted",
		);
		await expect(
			store.execute(
				"operation",
				"chat.prompt",
				{ text: "second" },
				() => "duplicate",
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	} finally {
		db.close();
	}
});

test("accepted operations from a crashed backend are unresolved and never automatically replayed", async () => {
	const db = new Database(":memory:");
	try {
		let executions = 0;
		const first = new DirectOperationStore(db, "generation-a");
		void first.execute(
			"operation",
			"agents.run",
			{ workspaceId: "workspace" },
			() => {
				executions++;
				return new Promise(() => {});
			},
		);
		const second = new DirectOperationStore(db, "generation-b");
		expect(second.status("operation")).toMatchObject({ status: "unresolved" });
		await expect(
			second.execute(
				"operation",
				"agents.run",
				{ workspaceId: "workspace" },
				() => {
					executions++;
				},
			),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(executions).toBe(1);
	} finally {
		db.close();
	}
});

test("concurrent retries share one accepted operation and its final result", async () => {
	const db = new Database(":memory:");
	try {
		const store = new DirectOperationStore(db, "generation");
		let release!: (value: string) => void;
		let executions = 0;
		const first = store.execute(
			"operation",
			"terminal.createSession",
			{},
			() => {
				executions++;
				return new Promise<string>((resolve) => {
					release = resolve;
				});
			},
		);
		const retry = store.execute(
			"operation",
			"terminal.createSession",
			{},
			() => {
				executions++;
			},
		);
		await Promise.resolve();
		release("terminal");
		expect(await retry).toEqual(await first);
		expect(executions).toBe(1);
	} finally {
		db.close();
	}
});

test("an exception after a side effect remains unresolved and cannot be replayed", async () => {
	const db = new Database(":memory:");
	try {
		const store = new DirectOperationStore(db, "generation");
		let launches = 0;
		await expect(
			store.execute("operation", "agents.run", {}, () => {
				launches++;
				throw new Error("Response construction failed after launch");
			}),
		).rejects.toThrow("after launch");
		expect(store.status("operation")).toMatchObject({ status: "unresolved" });
		await expect(
			store.execute("operation", "agents.run", {}, () => {
				launches++;
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(launches).toBe(1);
	} finally {
		db.close();
	}
});

test("maintenance drain persists and blocks new work until its owner commits", async () => {
	const db = new Database(":memory:");
	try {
		const first = new DirectOperationStore(db, "generation-a");
		first.beginDrain("upgrade-a");
		const second = new DirectOperationStore(db, "generation-b");
		expect(second.maintenance()).toMatchObject({
			mode: "draining",
			ownerId: "upgrade-a",
		});
		expect(() => second.assertCanCreate()).toThrow("draining");
		expect(() => second.endDrain("upgrade-b")).toThrow("owner");
		second.endDrain("upgrade-a");
		expect(() => second.assertCanCreate()).not.toThrow();
	} finally {
		db.close();
	}
});

test("freeze persists across restart and only its maintenance owner can release it", () => {
	const db = new Database(":memory:");
	try {
		const first = new DirectOperationStore(db, "generation-a");
		first.beginDrain("upgrade-a", true);
		const second = new DirectOperationStore(db, "generation-b");
		expect(second.maintenance()).toMatchObject({
			frozen: true,
			ownerId: "upgrade-a",
		});
		second.beginDrain("upgrade-a");
		expect(second.maintenance().frozen).toBe(true);
		second.endDrain("upgrade-a");
		expect(second.maintenance().frozen).toBe(false);
	} finally {
		db.close();
	}
});

test("a failed freeze write cannot leave a partially persisted maintenance transition", () => {
	const db = new Database(":memory:");
	try {
		const store = new DirectOperationStore(
			{
				exec: (sql) => db.exec(sql),
				prepare: (sql) => {
					if (sql.startsWith("UPDATE direct_freeze SET frozen = 1"))
						throw new Error("Injected disk failure");
					return db.prepare(sql);
				},
			},
			"generation",
		);
		expect(() => store.beginDrain("upgrade", true)).toThrow(
			"Injected disk failure",
		);
		expect(store.maintenance()).toEqual({
			mode: "active",
			ownerId: null,
			frozen: false,
		});
	} finally {
		db.close();
	}
});
