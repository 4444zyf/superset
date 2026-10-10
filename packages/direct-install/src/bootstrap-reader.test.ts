import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBootstrapReader } from "./bootstrap-reader";

test("bootstrap reader bounds a FIFO-open race and cleans its completion files", () => {
	const home = mkdtempSync(join(tmpdir(), "direct-bootstrap-reader-"));
	const fifo = join(home, "mutable-payload");
	try {
		expect(spawnSync("/usr/bin/mkfifo", ["-m", "600", fifo]).status).toBe(0);
		const result = spawnSync(
			"/bin/bash",
			[
				"-c",
				buildBootstrapReader(),
				"reader",
				home,
				"0.05",
				"/usr/bin/head",
				"-c",
				"33",
				fifo,
			],
			{ timeout: 500, killSignal: "SIGKILL", encoding: "utf8" },
		);
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

test("bootstrap deadline stops the owned parent before terminating its reader descendants", () => {
	const home = mkdtempSync(join(tmpdir(), "direct-bootstrap-tree-"));
	const pidFile = join(home, "pids");
	const fixture = join(home, "fixture.sh");
	try {
		writeFileSync(
			fixture,
			`#!/bin/sh\n/bin/sleep 30 &\nchild=$!\n/usr/bin/printf '%s %s' "$$" "$child" > "$1"\nwait "$child"\n`,
			{ mode: 0o700 },
		);
		const result = spawnSync(
			"/bin/bash",
			[
				"-c",
				buildBootstrapReader(),
				"reader",
				home,
				"0.1",
				"/bin/sh",
				fixture,
				pidFile,
			],
			{ timeout: 600, killSignal: "SIGKILL", encoding: "utf8" },
		);
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

test("a completed bootstrap read returns its bytes and original exit status", () => {
	const home = mkdtempSync(join(tmpdir(), "direct-bootstrap-ok-"));
	try {
		const result = spawnSync(
			"/bin/bash",
			[
				"-c",
				buildBootstrapReader(),
				"reader",
				home,
				"1",
				"/bin/sh",
				"-c",
				"/usr/bin/printf verified; exit 7",
			],
			{ timeout: 500, encoding: "utf8" },
		);
		expect(result.status).toBe(7);
		expect(result.stdout).toBe("verified");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
