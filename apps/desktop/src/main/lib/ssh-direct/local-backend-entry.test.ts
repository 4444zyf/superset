import { expect, test } from "bun:test";
import { runLocalBackendCommand } from "./local-backend-entry";

test("a local data query dispatches without starting a backend or a workload", async () => {
	let starts = 0;
	const requests: unknown[] = [];
	await runLocalBackendCommand(
		[
			"--query-local-data",
			JSON.stringify({ action: "listHistory" }),
			"--config",
			"/private/local/config.json",
		],
		{
			start: async () => {
				starts++;
				return { stop: async () => {} };
			},
			stopOwned: async () => {},
			queryLocalData: async (config, request) => {
				requests.push([config, request]);
			},
		},
	);
	expect(starts).toBe(0);
	expect(requests).toEqual([
		["/private/local/config.json", { action: "listHistory" }],
	]);
});

test("offline cleanup dispatches to the owned daemon stop without starting a backend", async () => {
	const calls: string[] = [];
	const result = await runLocalBackendCommand(
		["--stop-owned", "--config", "/userData/local/service-config.json"],
		{
			start: async () => {
				throw new Error("An offline cleanup must never start the backend");
			},
			stopOwned: async (configPath) => {
				calls.push(configPath);
			},
		},
	);
	expect(result).toBeNull();
	expect(calls).toEqual(["/userData/local/service-config.json"]);
});

test("offline import dispatches separately and never starts the backend", async () => {
	const calls: string[] = [];
	const handlers = {
		start: async () => {
			throw new Error("Must never start during import");
		},
		stopOwned: async () => {
			throw new Error("Import must not stop unrelated data");
		},
		importLocalData: async (configPath: string, source: string) => {
			calls.push(configPath, source);
		},
	};
	expect(
		await runLocalBackendCommand(
			[
				"--import-local-data",
				"/legacy/host/org",
				"--config",
				"/new/config.json",
			],
			handlers,
		),
	).toBeNull();
	expect(calls).toEqual(["/new/config.json", "/legacy/host/org"]);
	await expect(
		runLocalBackendCommand(
			["--import-local-data", "--config", "/new/config.json"],
			handlers,
		),
	).rejects.toThrow("source");
});
