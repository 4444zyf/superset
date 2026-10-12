import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBootstrapReader } from "./bootstrap-reader";

async function runReader(args: string[]) {
	const child = Bun.spawn(
		["/bin/bash", "-c", buildBootstrapReader(), "reader", ...args],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	try {
		const [status, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return { status, stdout, stderr };
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGTERM");
			await child.exited;
		}
	}
}

test("bootstrap reader bounds a FIFO-open race and cleans its completion files", async () => {
	const home = mkdtempSync(join(tmpdir(), "direct-bootstrap-reader-"));
	const fifo = join(home, "mutable-payload");
	try {
		expect(spawnSync("/usr/bin/mkfifo", ["-m", "600", fifo]).status).toBe(0);
		const result = await runReader([
			home,
			"0.05",
			"/usr/bin/head",
			"-c",
			"33",
			fifo,
		]);
		expect(result.status).toBe(124);
		expect(
			spawnSync("/bin/test", ["-e", join(home, "bootstrap-stream")]).status,
		).toBe(1);
		expect(
			spawnSync("/bin/test", ["-e", join(home, "bootstrap-completion")]).status,
		).toBe(1);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("bootstrap deadline stops the owned parent before terminating its reader descendants", async () => {
	const home = mkdtempSync(join(tmpdir(), "direct-bootstrap-tree-"));
	const pidFile = join(home, "pids");
	const fixture = join(home, "fixture.sh");
	try {
		writeFileSync(
			fixture,
			`#!/bin/sh\n/bin/sleep 30 &\nchild=$!\n/usr/bin/printf '%s %s' "$$" "$child" > "$1"\nwait "$child"\n`,
			{ mode: 0o700 },
		);
		const result = await runReader([home, "0.1", "/bin/sh", fixture, pidFile]);
		expect(result.status).toBe(124);
		for (const pid of readFileSync(pidFile, "utf8").split(" ")) {
			const state = spawnSync("/bin/ps", ["-p", pid, "-o", "stat="], {
				encoding: "utf8",
			}).stdout.trim();
			expect(state === "" || state.startsWith("Z")).toBe(true);
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("a completed bootstrap read returns its bytes and original exit status", async () => {
	const home = mkdtempSync(join(tmpdir(), "direct-bootstrap-ok-"));
	try {
		const result = await runReader([
			home,
			"1",
			"/bin/sh",
			"-c",
			"/usr/bin/printf verified; exit 7",
		]);
		expect(result.status).toBe(7);
		expect(result.stdout).toBe("verified");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
