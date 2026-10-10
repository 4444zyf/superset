import { expect, test } from "bun:test";
import { runDirectEntry } from "./entry";

test("the offline stop flag dispatches owned cleanup without starting an HTTP backend", async () => {
	const calls: string[] = [];
	const result = await runDirectEntry(
		["--stop-owned", "--config", "/private/config.json"],
		{
			start: async () => {
				calls.push("start-http");
				return { stop: async () => {} };
			},
			stopOwned: async (path) => {
				calls.push(`stop-owned:${path}`);
			},
		},
	);
	expect(result).toBeNull();
	expect(calls).toEqual(["stop-owned:/private/config.json"]);
});
