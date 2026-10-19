import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { DirectConnectionManager } from "./manager";
import { ConnectionRegistry } from "./registry";

test("startup restore cannot invoke installation when the existing endpoint is missing", async () => {
	const registry = new ConnectionRegistry(new Database(":memory:"));
	registry.save({ id: "mac", name: "Mac", host: "mini" });
	let installs = 0;
	const manager = new DirectConnectionManager({
		registry,
		runtime: {
			exec: async (_profile, command) =>
				command.includes("uname")
					? {
							stdout: [
								"Darwin",
								"arm64",
								"501",
								"alice",
								"/Users/alice",
								"staff",
								"14.5",
								"",
							].join("\0"),
							stderr: "",
							exitCode: 0,
						}
					: { stdout: "", stderr: "", exitCode: 1 },
			upload: async () => {
				throw new Error("Restore must not upload");
			},
			forward: async () => {
				throw new Error("There is no existing endpoint");
			},
		},
		install: async () => {
			installs++;
		},
	});
	try {
		await expect(
			manager.connect("mac", { mode: "restore-existing" }),
		).rejects.toThrow();
		expect(installs).toBe(0);
		expect(registry.get("mac")?.backendId).toBeUndefined();
	} finally {
		manager.dispose();
		registry.close();
	}
});

test("an explicit installation attempt cannot join a pending existing-only restore", async () => {
	const registry = new ConnectionRegistry(new Database(":memory:"));
	registry.save({ id: "mac", name: "Mac", host: "mini" });
	let finish!: () => void;
	let installs = 0;
	const manager = new DirectConnectionManager({
		registry,
		runtime: {
			exec: async () => {
				await new Promise<void>((r) => (finish = r));
				return { stdout: "", stderr: "", exitCode: 1 };
			},
			upload: async () => {},
			forward: async () => {
				throw new Error("No endpoint");
			},
		},
		install: async () => {
			installs++;
		},
	});
	try {
		const restoring = manager.connect("mac", { mode: "restore-existing" });
		await expect(manager.connect("mac")).rejects.toThrow(
			"different connection",
		);
		finish();
		await expect(restoring).rejects.toThrow();
		expect(installs).toBe(0);
	} finally {
		manager.dispose();
		registry.close();
	}
});

test("local restore selects the existing-only transport without starting or installing", async () => {
	const registry = new ConnectionRegistry(new Database(":memory:"));
	registry.save({
		id: "00000000-0000-4000-8000-000000000001",
		kind: "local",
		name: "Local",
		host: "localhost",
	});
	let existing = 0,
		explicit = 0;
	const manager = new DirectConnectionManager({
		registry,
		local: {
			test: async () => ({
				platform: "linux",
				architecture: "x64",
				uid: 1000,
				user: "agent",
				homeDir: "/home/agent",
				installed: true,
			}),
			connect: async () => {
				explicit++;
				throw new Error("must not start");
			},
			connectExisting: async () => {
				existing++;
				throw new Error("existing backend unavailable");
			},
		},
	});
	try {
		await expect(
			manager.connect("00000000-0000-4000-8000-000000000001", {
				mode: "restore-existing",
			}),
		).rejects.toThrow("existing backend unavailable");
		expect(existing).toBe(1);
		expect(explicit).toBe(0);
	} finally {
		manager.dispose();
		registry.close();
	}
});
