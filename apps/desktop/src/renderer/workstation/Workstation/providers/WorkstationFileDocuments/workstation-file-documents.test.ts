import { expect, test } from "bun:test";
import type {
	DirectDescriptor,
	DirectRpc,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { WorkstationFileDocuments } from "./workstation-file-documents";

const first: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	generation: 1,
	instanceId: "instance",
	capabilities: { files: true },
};
const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture() {
	const calls: DirectRpc[] = [];
	return {
		calls,
		api: {
			rpc: async (request: DirectRpc) => {
				calls.push(request);
				if (request.path === "filesystem.readFile")
					return {
						kind: "bytes",
						content: btoa("original\r\n"),
						revision: "r1",
						exceededLimit: false,
						byteLength: 10,
					};
				return { ok: true, revision: "r2" };
			},
		} as DirectWorkstationApi,
	};
}

test("multiple files keep their drafts after releasing their views", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const a = manager.acquire(first, "workspace", "/repo/first.txt");
	const b = manager.acquire(first, "workspace", "/repo/second.txt");
	await settle();
	a.setContent("first draft\n");
	b.setContent("second draft\n");
	manager.release(first, "workspace", "/repo/first.txt");
	const restored = manager.acquire(first, "workspace", "/repo/first.txt");
	expect(restored.id).toBe(a.id);
	expect(restored.content).toMatchObject({ value: "first draft\n" });
	expect(b.content).toMatchObject({ value: "second draft\n" });
	expect(f.calls).toHaveLength(2);
});

test("reconnecting the same backend keeps drafts and sends saves with the current generation", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const a = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	a.setContent("draft\n");
	const current = { ...first, generation: 2, instanceId: "replacement" };
	manager.activate(current);
	await a.save();
	expect(f.calls.at(-1)).toMatchObject({
		connectionId: "machine",
		generation: 2,
		path: "filesystem.writeFile",
		input: {
			workspaceId: "workspace",
			content: "draft\r\n",
			precondition: { ifMatch: "r1" },
			options: { create: false, overwrite: true },
		},
	});
});

test("a different backend cannot receive a previous backend's draft", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const a = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	a.setContent("private old draft");
	const next = { ...first, backendId: "different", generation: 2 };
	const b = manager.acquire(next, "workspace", "/repo/note.txt");
	await settle();
	expect(b.id).not.toBe(a.id);
	expect(b.content).toMatchObject({ value: "original\n" });
	await a.save();
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(0);
});

test("binary bytes remain read-only and never enter a text save", async () => {
	const f = fixture();
	f.api.rpc = async () =>
		({
			kind: "bytes",
			content: btoa("\0binary"),
			revision: "r1",
			exceededLimit: false,
			byteLength: 7,
		}) as never;
	const manager = new WorkstationFileDocuments(f.api);
	const a = manager.acquire(first, "workspace", "/repo/binary.txt");
	await settle();
	expect(a.content.kind).toBe("bytes");
	expect((await a.save()).status).toBe("error");
});

test("the file limit preserves open dirty documents instead of silently evicting them", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api, { maxDocuments: 1 });
	const a = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	a.setContent("retained draft");
	manager.release(first, "workspace", "/repo/note.txt");
	expect(() => manager.acquire(first, "workspace", "/repo/other.txt")).toThrow(
		"limit",
	);
	expect(
		manager.acquire(first, "workspace", "/repo/note.txt").content,
	).toMatchObject({ value: "retained draft" });
});

test("a stale activation cannot reactivate a previous backend before it rejects", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const a = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	a.setContent("old private draft");
	const next = { ...first, backendId: "different", generation: 2 };
	const b = manager.acquire(next, "workspace", "/repo/note.txt");
	await settle();
	b.setContent("current draft\n");
	expect(() => manager.activate(first)).toThrow("Stale");
	await a.save();
	await b.save();
	const writes = f.calls.filter((call) => call.path === "filesystem.writeFile");
	expect(writes).toHaveLength(1);
	expect(writes[0]).toMatchObject({
		generation: 2,
		input: { content: "current draft\r\n" },
	});
});

test("a late read from a released view cannot change a replacement document's line endings", async () => {
	const f = fixture();
	let finish!: (value: unknown) => void;
	let reads = 0;
	f.api.rpc = async (request) => {
		f.calls.push(request);
		if (request.path === "filesystem.readFile") {
			if (++reads === 1)
				return (await new Promise<unknown>((resolve) => {
					finish = resolve;
				})) as never;
			return {
				kind: "bytes",
				content: btoa("current\r\n"),
				revision: "r2",
				exceededLimit: false,
				byteLength: 9,
			} as never;
		}
		return { ok: true, revision: "r3" } as never;
	};
	const manager = new WorkstationFileDocuments(f.api);
	manager.acquire(first, "workspace", "/repo/note.txt");
	manager.release(first, "workspace", "/repo/note.txt");
	const current = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	finish({
		kind: "bytes",
		content: btoa("old\n"),
		revision: "r1",
		exceededLimit: false,
		byteLength: 4,
	});
	await settle();
	current.setContent("current draft\n");
	await current.save();
	expect(f.calls.at(-1)).toMatchObject({
		input: { content: "current draft\r\n", precondition: { ifMatch: "r2" } },
	});
});

test("a confirmed remote rename keeps the original document id, draft and CRLF codec", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/src/note.txt");
	await settle();
	document.setContent("draft\n");
	manager.dispatchFsEvent(first, "workspace", {
		kind: "rename",
		oldAbsolutePath: "/repo/src",
		absolutePath: "/repo/renamed",
		isDirectory: true,
	});
	expect(manager.getDocuments(first, "workspace")[0]?.id).toBe(document.id);
	expect(document.absolutePath).toBe("/repo/renamed/note.txt");
	expect(document.content).toMatchObject({ value: "draft\n" });
	await document.save();
	expect(f.calls.at(-1)?.input).toMatchObject({
		absolutePath: "/repo/renamed/note.txt",
		content: "draft\r\n",
	});
	manager.activate({ ...first, generation: 2 });
	manager.dispatchFsEvent(first, "workspace", {
		kind: "delete",
		absolutePath: "/repo/renamed/note.txt",
	});
	expect(document.orphaned).toBe(false);
});

test("a directory event whose stat lost the race still affects known descendant documents", async () => {
	const f = fixture();
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/src/note.txt");
	await settle();
	document.setContent("private unsaved draft");
	manager.dispatchFsEvent(first, "workspace", {
		kind: "rename",
		oldAbsolutePath: "/repo/src",
		absolutePath: "/repo/moved",
	});
	expect(document.absolutePath).toBe("/repo/moved/note.txt");
	manager.dispatchFsEvent(first, "workspace", {
		kind: "delete",
		absolutePath: "/repo/moved",
	});
	expect(document.orphaned).toBe(true);
	expect(document.content).toMatchObject({ value: "private unsaved draft" });
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(0);
});

test("an explicit conflict overwrite checks the selected backend's current revision and preserves the draft codec", async () => {
	const f = fixture();
	f.api.rpc = async (request) => {
		f.calls.push(request);
		if (request.path === "filesystem.readFile")
			return {
				kind: "bytes",
				content: btoa("original\r\n"),
				revision: "r1",
				byteLength: 10,
				exceededLimit: false,
			} as never;
		if (request.path === "filesystem.getMetadata")
			return { kind: "file", revision: "current-r2" } as never;
		return (
			(request.input as { precondition?: { ifMatch: string } }).precondition
				?.ifMatch === "r1"
				? { ok: false, reason: "conflict" }
				: { ok: true, revision: "r3" }
		) as never;
	};
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	document.setContent("explicit draft\n");
	expect((await document.save()).status).toBe("conflict");
	await manager.resolveConflict(first, "workspace", document.id, "overwrite");
	expect(f.calls.at(-1)).toMatchObject({
		path: "filesystem.writeFile",
		generation: 1,
		input: {
			workspaceId: "workspace",
			absolutePath: "/repo/note.txt",
			content: "explicit draft\r\n",
			precondition: { ifMatch: "current-r2" },
			options: { create: false, overwrite: true },
		},
	});
	expect(document.dirty).toBe(false);
	expect(document.conflict).toBeNull();
});

test("only an explicit conflict action can recreate a deleted draft and the creation cannot overwrite a competing file", async () => {
	const f = fixture();
	let missing = false;
	f.api.rpc = async (request) => {
		f.calls.push(request);
		if (request.path === "filesystem.readFile") {
			if (missing) throw new Error("ENOENT");
			return {
				kind: "bytes",
				content: btoa("original\r\n"),
				revision: "r1",
				byteLength: 10,
				exceededLimit: false,
			} as never;
		}
		if (request.path === "filesystem.getMetadata") return null as never;
		return (
			(request.input as { options?: { create: boolean } }).options?.create
				? { ok: true, revision: "recreated" }
				: { ok: false, reason: "conflict" }
		) as never;
	};
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	document.setContent("retained draft\n");
	missing = true;
	manager.dispatchFsEvent(first, "workspace", {
		kind: "delete",
		absolutePath: "/repo/note.txt",
	});
	expect((await document.save({ force: true })).status).toBe("error");
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(0);
	expect((await document.save()).status).toBe("conflict");
	await manager.resolveConflict(first, "workspace", document.id, "overwrite");
	expect(f.calls.at(-1)).toMatchObject({
		path: "filesystem.writeFile",
		input: {
			content: "retained draft\r\n",
			options: { create: true, overwrite: false },
		},
	});
	expect(
		(f.calls.at(-1)?.input as { precondition?: unknown }).precondition,
	).toBeUndefined();
	expect(document.dirty).toBe(false);
	expect(document.orphaned).toBe(false);
});

test("a backend switch during overwrite inspection cannot send the old draft to either backend", async () => {
	const f = fixture();
	let inspected!: () => void, finish!: (value: unknown) => void;
	const inspecting = new Promise<void>((resolve) => {
		inspected = resolve;
	});
	f.api.rpc = async (request) => {
		f.calls.push(request);
		if (request.path === "filesystem.getMetadata") {
			inspected();
			return (await new Promise<unknown>((resolve) => {
				finish = resolve;
			})) as never;
		}
		if (request.path === "filesystem.writeFile")
			return { ok: false, reason: "conflict" } as never;
		return {
			kind: "bytes",
			content: btoa("original"),
			revision: "r1",
			byteLength: 8,
			exceededLimit: false,
		} as never;
	};
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	document.setContent("private old draft");
	await document.save();
	const pending = manager.resolveConflict(
		first,
		"workspace",
		document.id,
		"overwrite",
	);
	await inspecting;
	manager.activate({ ...first, backendId: "replacement", generation: 2 });
	finish({ kind: "file", revision: "stale" });
	await pending;
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(1);
	expect(document.content).toMatchObject({ value: "private old draft" });
	expect(document.saveError?.message).toContain("connection changed");
});

test("a competing creator during explicit recreation restores the original conflict instead of claiming a save", async () => {
	const f = fixture();
	f.api.rpc = async (request) => {
		f.calls.push(request);
		if (request.path === "filesystem.readFile")
			return {
				kind: "bytes",
				content: btoa("competing file"),
				revision: "r1",
				byteLength: 14,
				exceededLimit: false,
			} as never;
		if (request.path === "filesystem.getMetadata") return null as never;
		return (
			(request.input as { options?: { create: boolean } }).options?.create
				? { ok: false, reason: "exists" }
				: { ok: false, reason: "conflict" }
		) as never;
	};
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	document.setContent("retained private draft");
	await document.save();
	await manager.resolveConflict(first, "workspace", document.id, "overwrite");
	expect(document.dirty).toBe(true);
	expect(document.content).toMatchObject({ value: "retained private draft" });
	expect(document.conflict?.diskContent).toBe("competing file");
	expect(
		f.calls.filter((call) => call.path === "filesystem.writeFile"),
	).toHaveLength(2);
});

test("a deletion observed after a write started cannot be erased by its late successful receipt", async () => {
	const f = fixture();
	let finish!: (value: unknown) => void, writing!: () => void;
	const started = new Promise<void>((resolve) => {
		writing = resolve;
	});
	f.api.rpc = async (request) => {
		f.calls.push(request);
		if (request.path === "filesystem.readFile")
			return {
				kind: "bytes",
				content: btoa("original"),
				revision: "r1",
				byteLength: 8,
				exceededLimit: false,
			} as never;
		if (request.path === "filesystem.getMetadata") return null as never;
		if (!(request.input as { options?: { create: boolean } }).options?.create)
			return { ok: false, reason: "conflict" } as never;
		writing();
		return (await new Promise<unknown>((resolve) => {
			finish = resolve;
		})) as never;
	};
	const manager = new WorkstationFileDocuments(f.api);
	const document = manager.acquire(first, "workspace", "/repo/note.txt");
	await settle();
	document.setContent("retained draft");
	await document.save();
	const pending = manager.resolveConflict(
		first,
		"workspace",
		document.id,
		"overwrite",
	);
	await started;
	manager.dispatchFsEvent(first, "workspace", {
		kind: "delete",
		absolutePath: "/repo/note.txt",
		isDirectory: false,
	});
	finish({ ok: true, revision: "receipt-before-deletion" });
	await pending;
	expect(document.orphaned).toBe(true);
	expect(document.content).toMatchObject({ value: "retained draft" });
});
