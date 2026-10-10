import { expect, test } from "bun:test";

test("the direct entry imports without any Superset cloud authentication environment", () => {
	const environment = { ...process.env };
	for (const key of [
		"AUTH_TOKEN",
		"SUPERSET_API_URL",
		"ORGANIZATION_ID",
		"HOST_DB_PATH",
		"HOST_MIGRATIONS_FOLDER",
		"HOST_SERVICE_SECRET",
		"RELAY_URL",
	])
		delete environment[key];
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--no-env-file",
			"-e",
			"await import('./src/direct-serve.ts'); process.exit(0)",
		],
		{
			cwd: new URL("../..", import.meta.url).pathname,
			env: environment,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(result.stderr.toString()).not.toContain(
		"Invalid environment variables",
	);
	expect(result.exitCode).toBe(0);
});
