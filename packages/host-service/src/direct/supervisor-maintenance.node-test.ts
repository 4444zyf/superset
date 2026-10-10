import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the resident local supervisor bounds its open log while its backend stays alive without a managed activation adapter", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "direct-local-supervisor-"));
	mkdirSync(join(homeDir, "logs"), { mode: 0o700 });
	const log = join(homeDir, "logs", "service.log");
	writeFileSync(log, "", { mode: 0o600 });
	const backend = join(homeDir, "backend.js");
	writeFileSync(
		backend,
		"console.log('backend-ready'); setInterval(() => {}, 1000);\n",
	);
	const configPath = join(homeDir, "config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			installationMode: "local",
			backendId: "00000000-0000-4000-8000-000000000001",
			namespaceId: "00000000-0000-4000-8000-000000000002",
			homeDir,
			secretFile: join(homeDir, "secret"),
			migrationsFolder: join(homeDir, "migrations"),
			hostServicePath: backend,
			allowedOrigins: [],
		}),
		{ mode: 0o600 },
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let watcher: ReturnType<typeof watch> | undefined;
	const rotated = new Promise<void>((resolve) => {
		watcher = watch(log, () => {
			if (statSync(log).size === 1024 * 1024) resolve();
		});
	});
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			join(
				dirname(fileURLToPath(import.meta.url)),
				"..",
				"direct-supervisor-serve.ts",
			),
			"--config",
			configPath,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const exited = once(child, "close");
	let diagnostics = "";
	child.stderr.on("data", (chunk) => {
		diagnostics += chunk;
	});
	try {
		const ready = new Promise<void>((resolve) => {
			child.stdout.on("data", (chunk) => {
				if (String(chunk).includes("backend-ready")) resolve();
			});
		});
		await Promise.race([
			ready,
			exited.then(() => {
				throw new Error(`Backend did not start: ${diagnostics}`);
			}),
		]);
		writeFileSync(log, Buffer.alloc(10 * 1024 * 1024 + 1, "a"));
		await Promise.race([
			rotated,
			new Promise<void>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								`The live local supervisor never bounded its log: ${diagnostics}`,
							),
						),
					1500,
				);
			}),
		]);
		assert.equal(child.exitCode, null);
		assert.equal(statSync(log).size, 1024 * 1024);
	} finally {
		clearTimeout(timer);
		watcher?.close();
		child.kill("SIGTERM");
		await exited;
		rmSync(homeDir, { recursive: true, force: true });
	}
});
