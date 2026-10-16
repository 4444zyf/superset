import { describe, expect, test } from "bun:test";
import {
	collectProcessSignalTargets,
	readForegroundProcessState,
	parseProcessTable,
} from "./process-tree.ts";

describe("parseProcessTable", () => {
	test("preserves decimal and opaque hexadecimal OS session identities", () => {
		const rows = parseProcessTable(
			[
				"100 1 100 pts/0 Ss 100",
				"200 1 200 ttys012 S fffffe001abc1230",
				"300 1 300 ttys013 S 0",
			].join("\n"),
		);
		expect(rows[0]?.sessionId).toBe("100");
		expect(rows[1]?.sessionId).toBe("fffffe001abc1230");
		expect(rows[2]?.sessionId).toBeUndefined();
	});

	test("parses pid/ppid/pgid/tty columns", () => {
		const rows = parseProcessTable(
			[
				"  100   1  100 ttys012  Ss",
				"  200 100  100 ttys012  S",
				"  300   1  300 ??       S",
			].join("\n"),
		);
		expect(rows).toEqual([
			{ pid: 100, ppid: 1, pgid: 100, tty: "ttys012" },
			{ pid: 200, ppid: 100, pgid: 100, tty: "ttys012" },
			{ pid: 300, ppid: 1, pgid: 300, tty: null },
		]);
	});

	test("normalizes no-tty markers to null", () => {
		for (const marker of ["??", "?", "-"]) {
			const rows = parseProcessTable(`  100   1  100 ${marker}  S`);
			expect(rows[0]?.tty).toBeNull();
		}
	});

	test("drops zombie rows", () => {
		const rows = parseProcessTable(
			["  100   1  100 ttys000  Ss", "  200 100  100 ttys000  Z"].join("\n"),
		);
		expect(rows.map((r) => r.pid)).toEqual([100]);
	});

	test("drops malformed rows", () => {
		const rows = parseProcessTable(
			["garbage", "  0  1  1 ?? S", "  100  1  0 ?? S", ""].join("\n"),
		);
		expect(rows).toEqual([]);
	});
});

describe("collectProcessSignalTargets — caller-ancestry protection", () => {
	const row = (
		pid: number,
		ppid: number,
		pgid: number,
		tty: string | null = null,
		sessionId?: string,
	) => ({ pid, ppid, pgid, tty, sessionId });

	test("TTY expansion stays inside the root's proven OS session", () => {
		const table = [
			row(100, 1, 100, "pts/0", "100"),
			row(200, 1, 200, "pts/0", "100"),
			row(900, 1, 900, "pts/0", "900"),
			row(901, 1, 901, "pts/0"),
		];
		const targets = collectProcessSignalTargets(100, {
			table,
			ttyName: "pts/0",
			excludeCurrentProcessGroup: false,
		});
		expect(targets).toEqual([
			{ target: "pgid", id: 100 },
			{ target: "pgid", id: 200 },
			{ target: "pid", id: 100 },
			{ target: "pid", id: 200 },
		]);
		expect(
			collectProcessSignalTargets(901, {
				table,
				ttyName: "pts/0",
				excludeCurrentProcessGroup: false,
			}),
		).toEqual([
			{ target: "pgid", id: 901 },
			{ target: "pid", id: 901 },
		]);
	});

	test("never signals a group the caller's ancestor chain belongs to", () => {
		// A target-tree member sharing a pgid with the caller's ancestor
		// (a process that never called setsid) must not drag the invoking
		// shell/terminal/test-runner into a killpg — this has SIGKILLed
		// developer sessions.
		const table = [
			row(process.pid, 4000, 5000),
			row(4000, 1, 4500), // caller's ancestor
			row(100, 1, 100), // kill root
			row(101, 100, 4500), // tree member colliding with ancestor's group
			row(102, 100, 102), // tree member in its own group
		];
		const targets = collectProcessSignalTargets(100, { table });
		const pgids = targets.filter((t) => t.target === "pgid").map((t) => t.id);
		const pids = targets.filter((t) => t.target === "pid").map((t) => t.id);
		expect(pgids).not.toContain(4500);
		expect(pgids).not.toContain(5000);
		expect(pgids).toEqual(expect.arrayContaining([100, 102]));
		// The colliding tree member itself is still signalled by pid.
		expect(pids).toEqual(expect.arrayContaining([100, 101, 102]));
		expect(pids).not.toContain(4000);
		expect(pids).not.toContain(process.pid);
	});

	test("tty straggler matching never adds the caller's ancestors", () => {
		const table = [
			row(process.pid, 4000, 5000, "ttys009"),
			row(4000, 1, 4500, "ttys009"), // ancestor on the same tty
			row(100, 1, 100, "ttys009", "100"), // kill root on the session tty
			row(900, 1, 900, "ttys009", "100"), // same-session straggler
		];
		const targets = collectProcessSignalTargets(100, {
			table,
			ttyName: "ttys009",
		});
		const pids = targets.filter((t) => t.target === "pid").map((t) => t.id);
		expect(pids).toEqual(expect.arrayContaining([100, 900]));
		expect(pids).not.toContain(4000);
		expect(pids).not.toContain(process.pid);
	});
});

test("foreground inspection preserves unavailable state for run-stop confirmation", () => {
	expect(
		readForegroundProcessState(100, () => ({ status: 1, stdout: "" })),
	).toBeNull();
	expect(
		readForegroundProcessState(100, () => ({ status: 0, stdout: "?? 100" })),
	).toBeNull();
	expect(
		readForegroundProcessState(100, () => ({ status: 0, stdout: "200 100" })),
	).toBe(true);
	expect(
		readForegroundProcessState(100, () => ({ status: 0, stdout: "100 100" })),
	).toBe(false);
});
