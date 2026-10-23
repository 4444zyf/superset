import { expect, test } from "bun:test";
import { FileTree } from "@pierre/trees";
import { asDirectoryHandle } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/utils/treePath";
import {
	FileTreeController,
	type RemoteTreeEntry,
} from "./file-tree-controller";

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("the original tree loads an expanded remote folder once and retains its siblings", async () => {
	const model = new FileTree({ paths: [], initialExpansion: "closed" });
	const calls: string[] = [];
	const controller = new FileTreeController(model, "/repo", async (path) => {
		calls.push(path);
		return path === "/repo"
			? [
					{ absolutePath: "/repo/src", kind: "directory" },
					{ absolutePath: "/repo/note.txt", kind: "file" },
				]
			: [{ absolutePath: "/repo/src/index.ts", kind: "file" }];
	});
	controller.start();
	await settle();
	const directory = asDirectoryHandle(model.getItem("src/"));
	expect(directory).not.toBeNull();
	directory?.expand();
	directory?.expand();
	await settle();
	expect(calls).toEqual(["/repo", "/repo/src"]);
	expect(model.getItem("src/index.ts")).not.toBeNull();
	expect(asDirectoryHandle(model.getItem("src/"))?.isExpanded()).toBe(true);
	expect(model.getItem("note.txt")).not.toBeNull();
	controller.stop();
	model.cleanUp();
});

test("a directory reply from a stopped tree cannot appear in its replacement", async () => {
	const model = new FileTree({ paths: [] });
	let finish!: (entries: RemoteTreeEntry[]) => void;
	const controller = new FileTreeController(
		model,
		"/old",
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	controller.start();
	controller.stop();
	const replacement = new FileTreeController(model, "/new", async () => [
		{ absolutePath: "/new/current.txt", kind: "file" },
	]);
	replacement.start();
	await settle();
	finish([{ absolutePath: "/old/stale.txt", kind: "file" }]);
	await settle();
	expect(model.getItem("stale.txt")).toBeNull();
	expect(model.getItem("current.txt")).not.toBeNull();
	replacement.stop();
	model.cleanUp();
});

test("directory responses cannot install paths outside the queried folder", async () => {
	const model = new FileTree({ paths: [] });
	const errors: string[] = [];
	const controller = new FileTreeController(
		model,
		"/repo",
		async () => [{ absolutePath: "/elsewhere/private.txt", kind: "file" }],
		{ onError: (error) => errors.push(error.message) },
	);
	controller.start();
	await settle();
	expect(model.getItem("/elsewhere/private.txt")).toBeNull();
	expect(errors).toHaveLength(1);
	controller.stop();
	model.cleanUp();
});

test("a bounded tree rejects an oversized batch without dropping the current paths", async () => {
	const model = new FileTree({ paths: [] });
	const errors: string[] = [];
	let load = 0;
	const controller = new FileTreeController(
		model,
		"/repo",
		async () =>
			++load === 1
				? [{ absolutePath: "/repo/retained.txt", kind: "file" }]
				: [
						{ absolutePath: "/repo/new.txt", kind: "file" },
						{ absolutePath: "/repo/extra.txt", kind: "file" },
					],
		{ maxPaths: 1, onError: (error) => errors.push(error.message) },
	);
	controller.start();
	await settle();
	await controller.refresh();
	expect(model.getItem("retained.txt")).not.toBeNull();
	expect(model.getItem("new.txt")).toBeNull();
	expect(errors).toHaveLength(1);
	controller.stop();
	model.cleanUp();
});

test("refresh removes a deleted expanded directory without querying its missing path", async () => {
	const model = new FileTree({ paths: [], initialExpansion: "closed" });
	let deleted = false;
	const calls: string[] = [];
	const errors: Error[] = [];
	const controller = new FileTreeController(
		model,
		"/repo",
		async (path) => {
			calls.push(path);
			if (path === "/repo")
				return [
					{ absolutePath: "/repo/note.txt", kind: "file" as const },
					...(!deleted
						? [{ absolutePath: "/repo/src", kind: "directory" as const }]
						: []),
				];
			if (deleted) throw new Error("Directory not found");
			return [{ absolutePath: "/repo/src/main.ts", kind: "file" }];
		},
		{ onError: (error) => errors.push(error) },
	);
	controller.start();
	await settle();
	asDirectoryHandle(model.getItem("src/"))?.expand();
	await settle();
	deleted = true;
	await controller.refresh();
	expect(errors).toEqual([]);
	expect(calls).toEqual(["/repo", "/repo/src", "/repo"]);
	expect(model.getItem("src/")).toBeNull();
	expect(model.getItem("src/main.ts")).toBeNull();
	expect(model.getItem("note.txt")).not.toBeNull();
	controller.stop();
	model.cleanUp();
});

test("watcher bursts coalesce while a listing is in flight and still install the final tree", async () => {
	const model = new FileTree({ paths: [] });
	let finish!: (entries: RemoteTreeEntry[]) => void;
	let reads = 0;
	const controller = new FileTreeController(model, "/repo", async () => {
		reads++;
		if (reads === 2)
			return new Promise((resolve) => {
				finish = resolve;
			});
		return [
			{
				absolutePath: reads === 1 ? "/repo/original.txt" : "/repo/latest.txt",
				kind: "file",
			},
		];
	});
	controller.start();
	await settle();
	const pending = controller.requestRefresh();
	const repeated = controller.requestRefresh();
	controller.requestRefresh();
	expect(repeated).toBe(pending);
	expect(reads).toBe(2);
	finish([{ absolutePath: "/repo/intermediate.txt", kind: "file" }]);
	await pending;
	expect(reads).toBe(3);
	expect(model.getItem("latest.txt")).not.toBeNull();
	expect(model.getItem("intermediate.txt")).toBeNull();
	controller.stop();
	model.cleanUp();
});

test("revealing a nested directory loads its ancestors and selects the folder without selecting a file", async () => {
	const model = new FileTree({ paths: [], initialExpansion: "closed" });
	const calls: string[] = [];
	const controller = new FileTreeController(model, "/repo", async (path) => {
		calls.push(path);
		return path === "/repo"
			? [{ absolutePath: "/repo/deep", kind: "directory" }]
			: path === "/repo/deep"
				? [{ absolutePath: "/repo/deep/nested", kind: "directory" }]
				: [{ absolutePath: "/repo/deep/nested/note.txt", kind: "file" }];
	});
	controller.start();
	try {
		expect(await controller.revealDirectory("/repo/deep/nested")).toBe(true);
		expect(calls).toEqual(["/repo", "/repo/deep", "/repo/deep/nested"]);
		expect(model.getSelectedPaths()).toEqual(["deep/nested/"]);
		expect(asDirectoryHandle(model.getItem("deep/"))?.isExpanded()).toBe(true);
		expect(asDirectoryHandle(model.getItem("deep/nested/"))?.isExpanded()).toBe(
			true,
		);
		expect(model.getItem("deep/nested/note.txt")).not.toBeNull();
	} finally {
		controller.stop();
		model.cleanUp();
	}
});

test("directory reveal refuses outside paths and cannot select after its tree is stopped", async () => {
	const model = new FileTree({ paths: [] });
	let finish!: (entries: RemoteTreeEntry[]) => void;
	let reads = 0;
	const controller = new FileTreeController(model, "/repo", () => {
		reads++;
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	controller.start();
	expect(await controller.revealDirectory("/repo-other/nested")).toBe(false);
	expect(await controller.revealDirectory("/repo/../outside")).toBe(false);
	expect(reads).toBe(1);
	const pending = controller.revealDirectory("/repo/nested");
	controller.stop();
	finish([{ absolutePath: "/repo/nested", kind: "directory" }]);
	expect(await pending).toBe(false);
	expect(model.getSelectedPaths()).toEqual([]);
	model.cleanUp();
});

test("a newer directory reveal keeps selection when an earlier listing replies late", async () => {
	const model = new FileTree({ paths: [] });
	let finish!: (entries: RemoteTreeEntry[]) => void;
	const controller = new FileTreeController(model, "/repo", async (path) =>
		path === "/repo"
			? [
					{ absolutePath: "/repo/a", kind: "directory" },
					{ absolutePath: "/repo/b", kind: "directory" },
				]
			: path === "/repo/a"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: [],
	);
	controller.start();
	await settle();
	try {
		const old = controller.revealDirectory("/repo/a");
		expect(await controller.revealDirectory("/repo/b")).toBe(true);
		finish([]);
		expect(await old).toBe(false);
		expect(model.getSelectedPaths()).toEqual(["b/"]);
	} finally {
		controller.stop();
		model.cleanUp();
	}
});
