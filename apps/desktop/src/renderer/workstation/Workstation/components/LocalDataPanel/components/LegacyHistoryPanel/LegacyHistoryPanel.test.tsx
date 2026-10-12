import { afterEach, expect, test } from "bun:test";
import type {
	ImportedLegacyHistoryChunk,
	ImportedLegacyHistoryEntry,
} from "@superset/shared/direct-legacy-data";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { LegacyHistoryPanel } from "./LegacyHistoryPanel";

afterEach(cleanup);

const entry: ImportedLegacyHistoryEntry = {
	kind: "static",
	workspaceId: "workspace",
	terminalId: "terminal",
	cwd: "/repo/archive",
	cols: 80,
	rows: 24,
	startedAt: "2026-01-01T00:00:00Z",
	agentId: "codex",
	agentSessionId: "provider-session",
};

function chunk(text: string, byteOffset = 0): ImportedLegacyHistoryChunk {
	return {
		kind: "static",
		workspaceId: entry.workspaceId,
		terminalId: entry.terminalId,
		text,
		byteOffset,
		totalBytes: 16384,
	};
}

test("archived history uses bounded text pages without attaching or starting a terminal", async () => {
	const reads: unknown[] = [];
	const api = {
		listLegacyHistory: async () => ({ entries: [entry], total: 1 }),
		readLegacyHistory: async (options: { byteOffset?: number }) => {
			reads.push(options);
			return options.byteOffset
				? chunk("第二页", options.byteOffset)
				: {
						...chunk("旧任务 <script>not executed</script>"),
						nextByteOffset: 8190,
					};
		},
	};
	render(
		<LegacyHistoryPanel api={api} namespaceId="namespace" onError={() => {}} />,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: /\/repo\/archive/ }),
	);
	await screen.findByText("旧任务 <script>not executed</script>");
	expect(document.querySelector("section script")).toBeNull();
	expect(screen.queryByRole("textbox")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Next part" }));
	await screen.findByText("第二页");
	expect(screen.queryByText("旧任务 <script>not executed</script>")).toBeNull();
	expect(reads).toEqual([
		{
			namespaceId: "namespace",
			workspaceId: "workspace",
			terminalId: "terminal",
			byteOffset: 0,
			byteLimit: 8192,
		},
		{
			namespaceId: "namespace",
			workspaceId: "workspace",
			terminalId: "terminal",
			byteOffset: 8190,
			byteLimit: 8192,
		},
	]);
});

test("a late transcript from another namespace cannot replace the selected namespace's history", async () => {
	let finishOld!: (value: ImportedLegacyHistoryChunk) => void;
	const reads: string[] = [];
	const api = {
		listLegacyHistory: async () => ({ entries: [entry], total: 1 }),
		readLegacyHistory: async (options: { namespaceId: string }) => {
			reads.push(options.namespaceId);
			if (options.namespaceId === "old")
				return await new Promise<ImportedLegacyHistoryChunk>((resolve) => {
					finishOld = resolve;
				});
			return chunk("current transcript");
		},
	};
	const onError = () => {};
	const view = render(
		<LegacyHistoryPanel api={api} namespaceId="old" onError={onError} />,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: /\/repo\/archive/ }),
	);
	await waitFor(() => expect(finishOld).toBeDefined());
	view.rerender(
		<LegacyHistoryPanel api={api} namespaceId="current" onError={onError} />,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: /\/repo\/archive/ }),
	);
	await screen.findByText("current transcript");
	await act(async () => finishOld(chunk("stale transcript")));
	expect(Boolean(screen.queryByText("stale transcript"))).toBe(false);
	expect(Boolean(screen.queryByText("current transcript"))).toBe(true);
	expect(reads).toEqual(["old", "current"]);
});

test("history list pagination replaces its page instead of accumulating entries", async () => {
	const offsets: number[] = [];
	const api = {
		listLegacyHistory: async (options: { offset?: number }) => {
			offsets.push(options.offset ?? 0);
			return options.offset
				? {
						entries: [{ ...entry, terminalId: "second", cwd: "/repo/second" }],
						total: 51,
					}
				: { entries: [entry], total: 51, nextOffset: 50 };
		},
		readLegacyHistory: async () => chunk("text"),
	};
	render(
		<LegacyHistoryPanel api={api} namespaceId="namespace" onError={() => {}} />,
	);
	await screen.findByRole("button", { name: /\/repo\/archive/ });
	fireEvent.click(screen.getByRole("button", { name: "Next page" }));
	await screen.findByRole("button", { name: /\/repo\/second/ });
	expect(
		Boolean(screen.queryByRole("button", { name: /\/repo\/archive/ })),
	).toBe(false);
	expect(offsets).toEqual([0, 50]);
});
