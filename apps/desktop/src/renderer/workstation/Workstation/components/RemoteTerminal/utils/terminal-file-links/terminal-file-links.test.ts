import { expect, test } from "bun:test";
import {
	LocalLinkDetector,
	TerminalLinkResolver,
} from "renderer/lib/terminal/links";
import type { DirectWorkstationApi } from "../../../../../../../shared/direct-workstation";
import { terminalFileLinks } from "./terminal-file-links";

test("the original detector resolves a remote stack trace and keeps the original line suffix", async () => {
	const requests: unknown[] = [];
	const opened: unknown[] = [];
	const links = terminalFileLinks({
		api: {
			rpc: async (request: unknown) => {
				requests.push(request);
				return {
					resolvedPath: "/srv/project/src/example.ts",
					isDirectory: false,
				};
			},
		} as DirectWorkstationApi,
		connection: {
			connectionId: "ssh",
			backendId: "b",
			namespaceId: "n",
			instanceId: "i",
			generation: 4,
			capabilities: { workstationFilesV1: true },
		},
		workspaceId: "workspace",
		isCurrent: () => true,
		isReviewing: () => false,
		onOpenFile: (target) => opened.push(target),
	});
	const { stat, onFileLinkClick } = links;
	if (!stat || !onFileLinkClick) throw new Error("File handlers missing");
	const detector = new LocalLinkDetector(new TerminalLinkResolver(stat));
	const [link] = await detector.detect("src/example.ts:12:7");
	expect(link).toMatchObject({
		resolvedPath: "/srv/project/src/example.ts",
		row: 12,
		col: 7,
	});
	const event = new MouseEvent("click", { ctrlKey: true, cancelable: true });
	if (!link) throw new Error("Original detector missed the stack trace");
	onFileLinkClick(event, link);
	expect(event.defaultPrevented).toBe(true);
	expect(opened).toEqual([
		{ absolutePath: "/srv/project/src/example.ts", line: 12, column: 7 },
	]);
	expect(requests[0]).toMatchObject({
		connectionId: "ssh",
		generation: 4,
		type: "mutation",
		path: "filesystem.statPath",
		input: { workspaceId: "workspace", path: "src/example.ts" },
	});
});

test("unsupported or failed path metadata produces no link and never fails the terminal", async () => {
	let calls = 0;
	const connection = {
		connectionId: "ssh",
		backendId: "b",
		namespaceId: "n",
		instanceId: "i",
		generation: 4,
		capabilities: { workstationFilesV1: false },
	};
	const handlers = terminalFileLinks({
		api: {
			rpc: async () => {
				calls++;
				throw new Error("Connection unavailable");
			},
		} as unknown as DirectWorkstationApi,
		connection,
		workspaceId: "workspace",
		isCurrent: () => true,
		isReviewing: () => false,
		onOpenFile: () => {
			throw new Error("Must not open");
		},
	});
	if (!handlers.stat) throw new Error("Stat handler missing");
	expect(await handlers.stat("note.txt")).toBeNull();
	expect(calls).toBe(0);
	connection.capabilities.workstationFilesV1 = true;
	if (!handlers.stat) throw new Error("Stat handler missing");
	expect(await handlers.stat("note.txt")).toBeNull();
	expect(calls).toBe(1);
});

test("the original detector keeps directory metadata and only its reveal gesture navigates", async () => {
	const opened: unknown[] = [];
	const handlers = terminalFileLinks({
		api: {
			rpc: async () => ({
				resolvedPath: "/repo/src/nested",
				isDirectory: true,
			}),
		} as unknown as DirectWorkstationApi,
		connection: {
			connectionId: "ssh",
			backendId: "b",
			namespaceId: "n",
			instanceId: "i",
			generation: 1,
			capabilities: { workstationFilesV1: true },
		},
		workspaceId: "w",
		isCurrent: () => true,
		isReviewing: () => false,
		onOpenFile: (target) => opened.push(target),
	});
	if (!handlers.stat || !handlers.onFileLinkClick)
		throw new Error("handlers missing");
	const [link] = await new LocalLinkDetector(
		new TerminalLinkResolver(handlers.stat),
	).detect("src/nested/");
	expect(link?.isDirectory).toBe(true);
	if (!link) throw new Error("directory link missing");
	handlers.onFileLinkClick(new MouseEvent("click"), link);
	handlers.onFileLinkClick(
		new MouseEvent("click", { ctrlKey: true, shiftKey: true }),
		link,
	);
	expect(opened).toEqual([]);
	handlers.onFileLinkClick(new MouseEvent("click", { ctrlKey: true }), link);
	expect(opened).toEqual([
		{ absolutePath: "/repo/src/nested", isDirectory: true },
	]);
});
