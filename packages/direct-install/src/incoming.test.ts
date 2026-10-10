import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildIncomingAdmission,
	INCOMING_SLOT_BYTES,
	incomingReservationBytes,
} from "./incoming";

const ids = [
	"11111111-1111-1111-1111-111111111111",
	"22222222-2222-2222-2222-222222222222",
	"33333333-3333-3333-3333-333333333333",
	"44444444-4444-4444-4444-444444444444",
	"55555555-5555-5555-5555-555555555555",
] as const;
const homes: string[] = [];
function cacheEntries(root: string) {
	return readdirSync(root).filter((name) => name !== ".admission-scan");
}
function fixture(slots = 0) {
	const home = mkdtempSync(join(tmpdir(), "direct-incoming-"));
	homes.push(home);
	const root = join(home, ".superset-direct/incoming");
	mkdirSync(root, { recursive: true, mode: 0o700 });
	for (let i = 0; i < slots; i++) {
		const path = join(root, `${ids[i]}.partial`);
		mkdirSync(path, { mode: 0o700 });
		writeFileSync(join(path, "active-payload"), "another A upload", {
			mode: 0o644,
		});
	}
	return { home, root };
}
async function admission(
	home: string,
	installId: string,
	maximumEntries?: number,
	findProgram?: string,
) {
	const child = Bun.spawn(["/bin/sh", "-s"], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	let script = buildIncomingAdmission({
		userHome: home,
		uid: process.getuid?.() ?? -1,
		installId,
		reservedBytes: 4096,
		maximumEntries,
	});
	if (findProgram)
		script = script.replace(
			'/usr/bin/find "$entry"',
			`'${findProgram}' "$entry"`,
		);
	child.stdin.write(script);
	child.stdin.end();
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

test("upload reservations include all path ancestors and reject oversized or absolute paths", () => {
	expect(incomingReservationBytes(100, ["nested/deeper/file"])).toBe(
		100 + 4 * 4096,
	);
	expect(() => incomingReservationBytes(INCOMING_SLOT_BYTES, ["file"])).toThrow(
		"cache budget",
	);
	expect(() => incomingReservationBytes(1, ["/absolute/file"])).toThrow(
		"release path",
	);
});
test("full abandoned upload slots refuse allocation without deleting any other upload", async () => {
	const f = fixture(4);
	const result = await admission(f.home, ids[4]);
	expect(result.exitCode).toBe(66);
	expect(cacheEntries(f.root).sort()).toEqual(
		ids.slice(0, 4).map((id) => `${id}.partial`),
	);
	expect(
		readFileSync(join(f.root, `${ids[0]}.partial/active-payload`), "utf8"),
	).toBe("another A upload");
});
test("two simultaneous A admissions cannot allocate the last slot twice", async () => {
	const f = fixture(3);
	const results = await Promise.all([
		admission(f.home, ids[3]),
		admission(f.home, ids[4]),
	]);
	expect(results.filter((result) => result.exitCode === 0)).toHaveLength(1);
	expect(
		results.filter((result) => [66, 75].includes(result.exitCode)),
	).toHaveLength(1);
	expect(
		readdirSync(f.root).filter((name) => name.endsWith(".partial")),
	).toHaveLength(4);
});
test("oversized legacy payload bytes fail closed even when there is a free slot", async () => {
	const f = fixture(1);
	truncateSync(
		join(f.root, `${ids[0]}.partial/active-payload`),
		INCOMING_SLOT_BYTES,
	);
	expect((await admission(f.home, ids[1])).exitCode).toBe(66);
	expect(cacheEntries(f.root)).toEqual([`${ids[0]}.partial`]);
});
test("private ancestor permissions and substituted symlinks refuse admission without following their targets", async () => {
	const f = fixture(1);
	chmodSync(join(f.root, `${ids[0]}.partial`), 0o755);
	expect((await admission(f.home, ids[1])).exitCode).toBe(65);
	chmodSync(join(f.root, `${ids[0]}.partial`), 0o700);
	chmodSync(join(f.root, `${ids[0]}.partial/active-payload`), 0o666);
	expect((await admission(f.home, ids[1])).exitCode).toBe(65);
	chmodSync(join(f.root, `${ids[0]}.partial/active-payload`), 0o644);
	symlinkSync("/etc/passwd", join(f.root, `${ids[0]}.partial/substituted`));
	expect((await admission(f.home, ids[1])).exitCode).toBe(65);
	expect(cacheEntries(f.root)).toEqual([`${ids[0]}.partial`]);
});
test("an abandoned PID marker and interrupted recovery marker do not permanently block bounded admission", async () => {
	const f = fixture();
	const deadOwner =
		"superset-upload-lock-2147483647-11111111-1111-1111-1111-111111111111";
	symlinkSync(deadOwner, join(f.root, ".admission.lock"));
	symlinkSync(deadOwner, join(f.root, ".admission.lock.recovery"));
	expect((await admission(f.home, ids[0])).exitCode).toBe(0);
	expect(cacheEntries(f.root)).toEqual([`${ids[0]}.partial`]);
});

test("admission cannot allocate a cache for a different SSH UID", async () => {
	const f = fixture();
	const child = Bun.spawn(["/bin/sh", "-s"], {
		stdin: "pipe",
		stdout: "ignore",
		stderr: "pipe",
	});
	child.stdin.write(
		buildIncomingAdmission({
			userHome: f.home,
			uid: (process.getuid?.() ?? -1) + 1,
			installId: ids[0],
			reservedBytes: 4096,
		}),
	);
	child.stdin.end();
	expect(await child.exited).toBe(65);
	expect(readdirSync(f.root)).toEqual([]);
});
test("filename control characters cannot inject fake stat records into capacity or owner validation", async () => {
	const f = fixture(1);
	writeFileSync(
		join(f.root, `${ids[0]}.partial`, "payload\n0 100600 0 1\n"),
		"data",
		{ mode: 0o600 },
	);
	expect((await admission(f.home, ids[1])).exitCode).toBe(0);
	expect(cacheEntries(f.root).sort()).toEqual(
		ids.slice(0, 2).map((id) => `${id}.partial`),
	);
});

test("entry capacity aborts the traversal before a free upload slot is allocated", async () => {
	const f = fixture(1);
	for (let i = 0; i < 5; i++)
		writeFileSync(join(f.root, `${ids[0]}.partial`, `file-${i}`), "", {
			mode: 0o600,
		});
	expect((await admission(f.home, ids[1], 4)).exitCode).toBe(66);
	expect(cacheEntries(f.root)).toEqual([`${ids[0]}.partial`]);
});

test("capacity cancellation terminates the owned producer descendants before releasing admission", async () => {
	const f = fixture(1);
	const pidFile = join(f.home, "producer-pids");
	const producer = join(f.home, "find-fixture");
	writeFileSync(
		producer,
		`#!/bin/sh
/bin/sleep 30 >/dev/null 2>&1 &
child=$!
/usr/bin/printf '%s %s' "$$" "$child" > '${pidFile}'
trap 'exit 0' TERM
trap '' PIPE
printf '${`${process.getuid?.()} 8180 0 1\n`.repeat(32768)}'
wait "$child"
`,
		{ mode: 0o700 },
	);
	let pids: string[] = [];
	try {
		expect((await admission(f.home, ids[1], 4, producer)).exitCode).toBe(66);
		pids = readFileSync(pidFile, "utf8").split(" ");
		for (const pid of pids) {
			const state = spawnSync("/bin/ps", ["-p", pid, "-o", "stat="], {
				encoding: "utf8",
			}).stdout.trim();
			expect(state === "" || state.startsWith("Z")).toBe(true);
		}
		expect(readdirSync(join(f.root, ".admission-scan"))).toEqual([]);
		expect(cacheEntries(f.root)).toEqual([`${ids[0]}.partial`]);
	} finally {
		for (const pid of pids) {
			const command = spawnSync("/bin/ps", ["-p", pid, "-o", "args="], {
				encoding: "utf8",
			}).stdout.trim();
			if (command === "/bin/sleep 30") {
				try {
					process.kill(Number(pid), "SIGKILL");
				} catch {}
			}
		}
	}
});

test("FIFO and hard-linked payloads are rejected without reading their contents", async () => {
	const f = fixture(1);
	const root = join(f.root, `${ids[0]}.partial`);
	const fifo = join(root, "fifo");
	const child = Bun.spawn(["/usr/bin/mkfifo", "-m", "600", fifo]);
	expect(await child.exited).toBe(0);
	expect((await admission(f.home, ids[1])).exitCode).toBe(65);
	rmSync(fifo);
	linkSync(join(root, "active-payload"), join(root, "second-link"));
	expect((await admission(f.home, ids[1])).exitCode).toBe(65);
	expect(cacheEntries(f.root)).toEqual([`${ids[0]}.partial`]);
});
