// biome-ignore lint/style/noRestrictedImports: This standalone benchmark measures the existing synchronous per-file subprocess cost.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createReleaseArchive } from "../../direct-install/src/archive.ts";
import { OpenSshRuntime } from "./ssh.ts";
import { createSshFixture } from "./ssh-fixture.ts";
import { createShapedSshFixture } from "./ssh-shaped-fixture.ts";

const samples = Number(process.env.BENCH_SAMPLES ?? 20);
const fileCount = Number(process.env.BENCH_FILES ?? 6230);
if (
	!Number.isSafeInteger(samples) ||
	samples < 3 ||
	samples > 100 ||
	!Number.isSafeInteger(fileCount) ||
	fileCount < 1 ||
	fileCount > 10000
)
	throw new Error("Invalid benchmark bounds");
const rttMs = Number(process.env.BENCH_RTT_MS ?? 0);
const megabitsPerSecond = Number(process.env.BENCH_MBPS ?? 20);
if (![0, 50, 150].includes(rttMs) || ![5, 20].includes(megabitsPerSecond))
	throw new Error("Invalid network benchmark shape");
const fixture =
	rttMs === 0
		? await createSshFixture()
		: await createShapedSshFixture(rttMs, megabitsPerSecond);
const output = resolve(process.argv[2] ?? "ssh-performance.json");
const results: Record<string, unknown> = {};
const measure = async (
	name: string,
	count: number,
	operation: () => Promise<void>,
) => {
	const values: number[] = [];
	for (let i = 0; i < count; i++) {
		const start = performance.now();
		await operation();
		values.push(performance.now() - start);
	}
	const sorted = [...values].sort((a, b) => a - b);
	const result = {
		n: count,
		valuesMs: values,
		medianMs: sorted[Math.floor(count / 2)],
		maxMs: sorted.at(-1),
		...(count >= 20 ? { p95Ms: sorted[Math.ceil(count * 0.95) - 1] } : {}),
	};
	results[name] = result;
	console.log(JSON.stringify({ name, ...result }));
};
try {
	const source = join(fixture.root, "source");
	const remote = join(fixture.root, "remote");
	mkdirSync(source);
	mkdirSync(remote);
	const files = Array.from({ length: fileCount }, (_, i) => ({
		path: `${String(i).padStart(5, "0")}.bin`,
		mode: 0o644,
		size: 2048,
		sha256: "",
	}));
	for (const file of files)
		writeFileSync(
			join(source, file.path),
			Buffer.concat([
				Buffer.from(
					"runtime sample ".repeat(80).slice(0, 1024).padEnd(1024, " "),
				),
				randomBytes(1024),
			]),
		);
	const packs = [1, 6].map((level) => ({
		level,
		path: join(fixture.root, `backend-${level}.tar.gz`),
	}));
	for (const pack of packs) {
		const start = performance.now();
		await createReleaseArchive(source, pack.path, files, pack.level);
		results[`compression-${pack.level}`] = {
			buildMs: performance.now() - start,
			compressedBytes: readFileSync(pack.path).length,
		};
	}
	for (const reuseConnections of [false, true]) {
		const runtime = new OpenSshRuntime({
			configFile: fixture.configFile,
			reuseConnections,
		});
		try {
			await measure(
				`control-${reuseConnections ? "shared-master" : "independent"}`,
				samples,
				async () => {
					const result = await runtime.exec(
						fixture.profile,
						"printf connected",
					);
					if (result.stdout !== "connected")
						throw new Error("SSH command failed");
				},
			);
			await measure(
				`files-${reuseConnections ? "shared-master" : "independent"}`,
				3,
				() =>
					runtime.uploadFiles(
						fixture.profile,
						files.map((file) => ({
							localPath: join(source, file.path),
							remotePath: join(remote, file.path),
						})),
					),
			);
			if (reuseConnections)
				for (const pack of packs)
					await measure(`archive-gzip-${pack.level}`, samples, () =>
						runtime.upload(
							fixture.profile,
							pack.path,
							join(remote, "backend.tar.gz"),
						),
					);
		} finally {
			runtime.dispose();
		}
	}
	await measure("per-file-read-process", 3, async () => {
		for (const file of files)
			execFileSync(
				process.platform === "darwin" ? "/usr/bin/head" : "/usr/bin/head",
				["-c", String(file.size + 1), join(source, file.path)],
				{ maxBuffer: file.size + 2 },
			);
	});
	writeFileSync(
		output,
		JSON.stringify(
			{
				source:
					process.env.GITHUB_SHA ??
					execFileSync("git", ["rev-parse", "HEAD"], {
						encoding: "utf8",
					}).trim(),
				platform: process.platform,
				arch: process.arch,
				runtime: process.versions.node,
				network: rttMs
					? {
							kind: "application-level TCP relay",
							addedRttMs: rttMs,
							rateLimitMbps: megabitsPerSecond,
						}
					: "loopback, no artificial delay",
				samples,
				fileCount,
				expandedBytes: fileCount * 2048,
				results,
			},
			null,
			2,
		),
	);
} finally {
	await fixture.close();
}
