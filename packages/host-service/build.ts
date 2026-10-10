/**
 * Bundles the host-service entry point into a single JS file that can be
 * executed by a standalone Node.js runtime. Native addons (better-sqlite3,
 * node-pty) are marked external and must be resolved at runtime from
 * lib/native/ in the distribution bundle.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { linguiMacroPlugin } from "@superset/i18n/bun-plugin";

const outdir = "dist";
if (!existsSync(outdir)) {
	mkdirSync(outdir, { recursive: true });
}

const result = await Bun.build({
	entrypoints: ["src/serve.ts"],
	plugins: [linguiMacroPlugin],
	target: "node",
	outdir,
	naming: "host-service.js",
	format: "esm",
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	external: [
		"better-sqlite3",
		"node-pty",
		"@parcel/watcher",
		// Optional peer of webdriverio; the browser-driver code path never
		// executes at runtime, so these must not be bundled.
		"puppeteer-core",
		"chromium-bidi",
	],
});

if (!result.success) {
	console.error("[host-service] build failed:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

for (const entry of [
	{ source: "src/direct-serve.ts", output: "host-service-direct.js" },
	{ source: "src/direct-supervisor.ts", output: "direct-supervisor.js" },
]) {
	const directResult = await Bun.build({
		entrypoints: [entry.source],
		plugins: [linguiMacroPlugin],
		target: "node",
		outdir,
		naming: entry.output,
		format: "esm",
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		external: ["better-sqlite3", "node-pty", "@parcel/watcher", "@anthropic-ai/claude-agent-sdk", "puppeteer-core", "chromium-bidi"],
	});
	if (!directResult.success) {
		for (const log of directResult.logs) console.error(log);
		throw new Error(`Direct backend bundle failed: ${entry.output}`);
	}
}

// Worker-thread bundle, emitted side-by-side so the pool's script
// resolution finds it next to host-service.js (see host-worker-pool.ts).
const workerResult = await Bun.build({
	entrypoints: ["src/workers/host-worker.ts"],
	plugins: [linguiMacroPlugin],
	target: "node",
	outdir,
	naming: "host-worker.js",
	format: "esm",
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
});

if (!workerResult.success) {
	console.error("[host-service] host-worker build failed:");
	for (const log of workerResult.logs) {
		console.error(log);
	}
	process.exit(1);
}

const chatMigrations = `${outdir}/chat-migrations`;
rmSync(chatMigrations, { recursive: true, force: true });
cpSync("../chat-runtime/src/db/drizzle", chatMigrations, { recursive: true });

console.log(
	`[host-service] bundled to ${outdir}/host-service.js + ${outdir}/host-worker.js + ${chatMigrations}/`,
);
