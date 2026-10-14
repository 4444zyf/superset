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
