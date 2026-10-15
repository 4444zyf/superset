import { afterEach, expect, test } from "bun:test";
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
import { readProjectScripts, writeProjectScripts } from "./project-scripts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
	const root = mkdtempSync(join(tmpdir(), "project-scripts-"));
	roots.push(root);
	return { root, file: join(root, ".superset/config.json") };
};
const scripts = {
	setup: ["echo setup"],
	teardown: ["echo teardown"],
	run: ["echo run"],
};

test("the new script snapshot writes the original config path and preserves unrelated keys", async () => {
	const f = fixture();
	const empty = await readProjectScripts(f.root);
	expect(empty.revision).toBeNull();
	await writeProjectScripts(f.root, {
		...scripts,
		expectedRevision: empty.revision,
	});
	expect(JSON.parse(readFileSync(f.file, "utf8"))).toEqual(scripts);
	const original = {
		...scripts,
		cwd: "apps/web",
		start: ["service start"],
		future: { enabled: true },
	};
	writeFileSync(f.file, JSON.stringify(original));
	const current = await readProjectScripts(f.root);
	const updated = await writeProjectScripts(f.root, {
		...scripts,
		setup: ["echo next"],
		expectedRevision: current.revision,
	});
	expect(updated.scripts.setup).toEqual(["echo next"]);
	expect(JSON.parse(readFileSync(f.file, "utf8"))).toEqual({
		...original,
		setup: ["echo next"],
	});
});

test("an external edit or create rejects a stale save without overwriting it", async () => {
	const f = fixture();
	const empty = await readProjectScripts(f.root);
	mkdirSync(join(f.root, ".superset"));
	const other = JSON.stringify({ run: ["someone else"] });
	writeFileSync(f.file, other);
	await expect(
		writeProjectScripts(f.root, {
			...scripts,
			expectedRevision: empty.revision,
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(readFileSync(f.file, "utf8")).toBe(other);
	const current = await readProjectScripts(f.root);
	writeFileSync(f.file, JSON.stringify({ run: ["another change"] }));
	await expect(
		writeProjectScripts(f.root, {
			...scripts,
			expectedRevision: current.revision,
		}),
	).rejects.toMatchObject({ code: "CONFLICT" });
	expect(JSON.parse(readFileSync(f.file, "utf8")).run).toEqual([
		"another change",
	]);
});

test.each([
	"{bad json",
	JSON.stringify({ setup: "not an array" }),
	"[]",
	"null",
])("malformed existing config cannot become an empty editable form: %s", async (content) => {
	const f = fixture();
	mkdirSync(join(f.root, ".superset"));
	writeFileSync(f.file, content);
	await expect(readProjectScripts(f.root)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	expect(readFileSync(f.file, "utf8")).toBe(content);
});

test("oversized config and a linked config directory remain untouched", async () => {
	const f = fixture();
	mkdirSync(join(f.root, ".superset"));
	const oversized = " ".repeat(512 * 1024 + 1);
	writeFileSync(f.file, oversized);
	await expect(readProjectScripts(f.root)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	rmSync(join(f.root, ".superset"), { recursive: true });
	const target = fixture();
	mkdirSync(join(target.root, ".superset"));
	writeFileSync(target.file, JSON.stringify(scripts));
	symlinkSync(join(target.root, ".superset"), join(f.root, ".superset"));
	await expect(readProjectScripts(f.root)).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	expect(JSON.parse(readFileSync(target.file, "utf8"))).toEqual(scripts);
});
