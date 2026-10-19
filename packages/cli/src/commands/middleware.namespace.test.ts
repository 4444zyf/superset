import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiClient } from "../lib/api-client";

const keys = [
	"SUPERSET_HOME_DIR",
	"SUPERSET_API_KEY",
	"SUPERSET_ORGANIZATION_ID",
	"SUPERSET_SANDBOX_WORKSPACE_ID",
] as const;
const saved = keys.map((key) => process.env[key]);
const directory = mkdtempSync(join(tmpdir(), "remix-cli-middleware-"));
process.env.SUPERSET_HOME_DIR = directory;
for (const key of keys.slice(1)) delete process.env[key];
const { default: middleware } = await import("./middleware");
afterAll(() => {
	for (let i = 0; i < keys.length; i++) {
		const value = saved[i];
		if (value === undefined) delete process.env[keys[i]!];
		else process.env[keys[i]!] = value;
	}
	rmSync(directory, { recursive: true, force: true });
});

test("an explicit namespace skips account and telemetry resolution and cannot use the cloud API", async () => {
	let cloudCalls = 0,
		source: unknown;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = Object.assign(
		async () => {
			cloudCalls++;
			throw new Error("Unexpected network access");
		},
		{
			preconnect: () => {
				cloudCalls++;
				throw new Error("Unexpected network access");
			},
		},
	) as typeof fetch;
	try {
		await middleware({
			options: { namespace: "/explicit/namespace" },
			commandPath: ["agents", "list"],
			next: async ({ ctx }) => {
				source = ctx.authSource;
				await expect(
					(ctx.api as ApiClient).analytics.captureEvent.mutate({} as never),
				).rejects.toThrow("unavailable");
			},
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	expect(source).toBe("direct");
	expect(cloudCalls).toBe(0);
	expect(existsSync(join(directory, "reported-commands.json"))).toBe(false);
	expect(existsSync(join(directory, "config.json"))).toBe(false);
});

test("commands without an explicit namespace retain the original account requirement", async () => {
	let entered = false;
	await expect(
		middleware({
			options: {},
			commandPath: ["agents", "list"],
			next: async () => {
				entered = true;
			},
		}),
	).rejects.toThrow("Not logged in");
	expect(entered).toBe(false);
});
