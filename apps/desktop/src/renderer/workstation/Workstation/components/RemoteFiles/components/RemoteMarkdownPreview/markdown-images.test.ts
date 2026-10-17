import { expect, test } from "bun:test";
import { MarkdownImageReader } from "./markdown-images";

test("markdown images share one bounded read and evict old completed bytes", async () => {
	const reads: string[] = [];
	const reader = new MarkdownImageReader({
		maxBytes: 4,
		maxCacheBytes: 4,
		maxEntries: 2,
		concurrency: 1,
		read: async (path, limit) => {
			reads.push(path);
			expect(limit).toBe(4);
			return { kind: "bytes", content: btoa("1234") };
		},
	});
	const a = reader.readFile("/remote/a.png"),
		b = reader.readFile("/remote/a.png");
	expect(a).toBe(b);
	expect(await a).toEqual(new Uint8Array([49, 50, 51, 52]));
	await reader.readFile("/remote/b.png");
	await reader.readFile("/remote/a.png");
	expect(reads).toEqual(["/remote/a.png", "/remote/b.png", "/remote/a.png"]);
	reader.dispose();
});
test("unsupported files and oversized image results never become preview bytes", async () => {
	let reads = 0;
	const reader = new MarkdownImageReader({
		maxBytes: 4,
		maxCacheBytes: 4,
		read: async () => {
			reads++;
			return { kind: "bytes", content: btoa("12345"), exceededLimit: true };
		},
	});
	await expect(reader.readFile("/remote/secret.txt")).rejects.toThrow();
	expect(reads).toBe(0);
	await expect(reader.readFile("/remote/large.png")).rejects.toThrow();
	expect(reads).toBe(1);
	reader.dispose();
});
test("switching the owner drops an in-flight image and does not launch its queued read", async () => {
	let current = true,
		finish!: (r: { kind: "bytes"; content: string }) => void;
	const calls: string[] = [];
	const reader = new MarkdownImageReader({
		concurrency: 1,
		isCurrent: () => current,
		read: async (path) => {
			calls.push(path);
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
	});
	const a = reader.readFile("/remote/a.png");
	const b = reader.readFile("/remote/b.png");
	const settled = Promise.allSettled([a, b]);
	current = false;
	reader.dispose();
	finish({ kind: "bytes", content: btoa("123") });
	expect((await settled).map((r) => r.status)).toEqual([
		"rejected",
		"rejected",
	]);
	expect(calls).toEqual(["/remote/a.png"]);
});

test("a saved markdown revision reloads its image while duplicate readers share that revision", async () => {
	let reads = 0;
	const reader = new MarkdownImageReader({
		read: async () => ({ kind: "bytes", content: new Uint8Array([++reads]) }),
	});
	expect(await reader.readFile("/remote/a.png", "revision-1")).toEqual(
		new Uint8Array([1]),
	);
	expect(await reader.readFile("/remote/a.png", "revision-2")).toEqual(
		new Uint8Array([2]),
	);
	expect(await reader.readFile("/remote/a.png", "revision-2")).toEqual(
		new Uint8Array([2]),
	);
	expect(reads).toBe(2);
	reader.dispose();
});

test("an independent image event rejects stale pending bytes and reloads without a markdown revision change", async () => {
	const results: ((value: { kind: "bytes"; content: Uint8Array }) => void)[] =
		[];
	const reader = new MarkdownImageReader({
		read: async () => new Promise((resolve) => results.push(resolve)),
	});
	const old = reader.readFile(
		"/repo/ignored/image.png",
		"same-markdown-revision",
	);
	const rejected = Promise.allSettled([old]);
	reader.invalidate([
		{ kind: "update", absolutePath: "/repo/ignored/image.png" },
	]);
	const next = reader.readFile(
		"/repo/ignored/image.png",
		"same-markdown-revision",
	);
	results[0]!({ kind: "bytes", content: new Uint8Array([1]) });
	results[1]!({ kind: "bytes", content: new Uint8Array([2]) });
	expect((await rejected)[0]?.status).toBe("rejected");
	expect(await next).toEqual(new Uint8Array([2]));
	expect(
		await reader.readFile("/repo/ignored/image.png", "same-markdown-revision"),
	).toEqual(new Uint8Array([2]));
	reader.dispose();
});

test("missing images retain bounded watch interest so their later creation refreshes the original preview", async () => {
	let missing = true;
	const reader = new MarkdownImageReader({
		maxEntries: 2,
		read: async () => {
			if (missing) throw new Error("ENOENT");
			return { kind: "bytes", content: new Uint8Array([7]) };
		},
	});
	await expect(reader.readFile("/repo/a.png")).rejects.toThrow();
	expect(reader.getPaths()).toEqual(["/repo/a.png"]);
	const before = reader.getResourceRevision();
	missing = false;
	reader.invalidate([{ kind: "create", absolutePath: "/repo/a.png" }]);
	expect(reader.getResourceRevision()).toBeGreaterThan(before);
	expect(await reader.readFile("/repo/a.png")).toEqual(new Uint8Array([7]));
	await reader.readFile("/repo/b.png");
	await reader.readFile("/repo/c.png");
	expect(reader.getPaths()).toEqual(["/repo/b.png", "/repo/c.png"]);
	reader.dispose();
	expect(reader.getPaths()).toEqual([]);
});
