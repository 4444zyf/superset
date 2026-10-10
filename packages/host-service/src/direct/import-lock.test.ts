import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDirectSupervisor } from "../direct-supervisor";
import { startDirectBackend } from "./runtime";

test("an offline import blocks both direct entry points before they initialize databases or terminal resources", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "direct-import-startup-"));
	mkdirSync(join(homeDir, "state"), { mode: 0o700 });
	const path = join(homeDir, "config.json");
	writeFileSync(
		path,
		JSON.stringify({
			installationMode: "local",
			backendId: "00000000-0000-4000-8000-000000000001",
			namespaceId: "00000000-0000-4000-8000-000000000002",
			homeDir,
			secretFile: join(homeDir, "missing-secret"),
			migrationsFolder: join(homeDir, "missing-migrations"),
			allowedOrigins: [],
		}),
		{ mode: 0o600 },
	);
	writeFileSync(
		join(homeDir, "state", "legacy-import.lock"),
		JSON.stringify({ pid: process.pid, importId: "pending-import" }),
		{ mode: 0o600 },
	);
	writeFileSync(join(homeDir, "state", "disabled"), "explicit-stop\n", {
		mode: 0o600,
	});
	try {
		await expect(startDirectBackend(path)).rejects.toThrow("offline import");
		await expect(runDirectSupervisor(path)).rejects.toThrow("offline import");
	} finally {
		rmSync(homeDir, { recursive: true, force: true });
	}
});
