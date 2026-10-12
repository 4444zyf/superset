import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listImportedLegacyHistory,
	readImportedLegacyHistory,
} from "./legacy-history";

const roots: string[] = [];
afterEach(() => {
	for (const path of roots.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function fixture() {
	const homeDir = mkdtempSync(join(tmpdir(), "legacy-static-"));
	roots.push(homeDir);
	const namespaceId = randomUUID(),
		workspaceId = randomUUID(),
		terminalId = randomUUID();
	const dir = join(
		homeDir,
		"host",
		namespaceId,
		"legacy-history",
		workspaceId,
		terminalId,
	);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(dir, "meta.json"),
		JSON.stringify({
			cwd: "/real/repository",
			cols: 80,
			rows: 24,
			startedAt: "2026-01-01T00:00:00.000Z",
			env: { TOKEN: "never-return" },
			command: "do not execute",
		}),
		{ mode: 0o600 },
	);
	writeFileSync(
		join(dir, "agent-session.json"),
		JSON.stringify({
			agentId: "codex",
			agentSessionId: "retained-session",
			prompted: true,
			updatedAt: 1,
			token: "never-return",
		}),
		{ mode: 0o600 },
	);
	writeFileSync(join(dir, "scrollback.bin"), "中文 archived output", {
		mode: 0o600,
	});
	return { homeDir, namespaceId, workspaceId, terminalId, dir };
}
test("lists static history and captured provider IDs without exposing execution settings", () => {
	const f = fixture();
	const before = readFileSync(join(f.dir, "meta.json"));
	const page = listImportedLegacyHistory(f);
	expect(page.total).toBe(1);
	expect(page.entries[0]).toMatchObject({
		workspaceId: f.workspaceId,
		terminalId: f.terminalId,
		kind: "static",
		cwd: "/real/repository",
		agentSessionId: "retained-session",
	});
	expect(JSON.stringify(page)).not.toContain("never-return");
	expect(JSON.stringify(page)).not.toContain("execute");
	expect(readFileSync(join(f.dir, "meta.json"))).toEqual(before);
});
test("scrollback paging keeps UTF-8 boundaries and returns a bounded static chunk", () => {
	const f = fixture();
	const first = readImportedLegacyHistory({ ...f, byteLimit: 4 }) as {
		text: string;
		nextByteOffset: number;
		totalBytes: number;
	};
	expect(first.text).toBe("中");
	expect(first.nextByteOffset).toBe(3);
	const next = readImportedLegacyHistory({
		...f,
		byteOffset: first.nextByteOffset,
		byteLimit: 4,
	}) as { text: string };
	expect(next.text).toBe("文 ");
	expect(first.totalBytes).toBe(Buffer.byteLength("中文 archived output"));
});
test("history refuses linked files and invalid resource IDs instead of reading outside the selected namespace", () => {
	const f = fixture();
	rmSync(join(f.dir, "scrollback.bin"));
	symlinkSync(join(f.dir, "meta.json"), join(f.dir, "scrollback.bin"));
	expect(() => readImportedLegacyHistory(f)).toThrow();
	expect(() =>
		readImportedLegacyHistory({ ...f, workspaceId: "../../elsewhere" }),
	).toThrow();
});

test("invalid UTF-8 scrollback fails instead of returning a nonadvancing page", () => {
	const f = fixture();
	writeFileSync(join(f.dir, "scrollback.bin"), Buffer.alloc(12, 0x80), {
		mode: 0o600,
	});
	expect(() => readImportedLegacyHistory({ ...f, byteLimit: 4 })).toThrow(
		"Invalid UTF-8 static scrollback",
	);
});
