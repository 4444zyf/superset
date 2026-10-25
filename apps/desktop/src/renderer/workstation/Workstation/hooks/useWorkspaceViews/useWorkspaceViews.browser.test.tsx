import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type {
	WorkspaceViewSnapshotV2,
	WorkspaceViewV2Save,
} from "shared/workspace-view-v2";
import type { WorkstationBrowserPane } from "shared/workstation-browser";
import { useWorkspaceViews } from "./useWorkspaceViews";

afterEach(cleanup);

function fixture(
	getBrowserHomepage?: () => { ready: boolean; url: string | null },
) {
	const descriptor: DirectDescriptor = {
		connectionId: "connection",
		generation: 4,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		capabilities: { workspaceViewRestoreV1: true },
	};
	let backing: WorkspaceViewSnapshotV2 = {
		schemaVersion: 2,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: false,
		activeConnectionId: descriptor.connectionId,
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: descriptor.connectionId,
				targetRevision: 1,
				backendId: descriptor.backendId,
				namespaceId: descriptor.namespaceId,
				serviceUid: 1000,
				autoConnect: false,
				activeTabId: "workspace-tab",
				workspaces: [
					{
						tabId: "workspace-tab",
						workspaceId: "workspace",
						activeTool: "terminal",
						activePaneId: "terminal",
						panes: [
							{
								paneId: "terminal",
								resourceId: "terminal",
								executionId: "execution",
								kind: "terminal",
							},
							{
								paneId: "browser",
								resourceId: "page",
								kind: "browser",
								browser: {
									url: "https://example.com/",
									pageTitle: "Page",
									faviconUrl: null,
								},
							},
						],
						layout: {
							type: "split",
							axis: "horizontal",
							ratio: 0.4,
							first: { type: "pane", paneId: "terminal" },
							second: { type: "pane", paneId: "browser" },
						},
					},
				],
			},
		],
	};
	const requests: unknown[] = [],
		saves: WorkspaceViewV2Save[] = [],
		updates: unknown[] = [],
		errors: string[] = [];
	const api = {
		getWorkspaceView: async () => {
			throw Error("V1 must not read the full V2 view");
		},
		saveWorkspaceView: async () => {
			throw Error("V1 must not save the V2 view");
		},
		getWorkspaceViewV2: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceViewV2: async (input: WorkspaceViewV2Save) => {
			saves.push(input);
			backing = {
				...input.view,
				schemaVersion: 2,
				revision: backing.revision + 1,
				updatedAt: 2,
			};
			return structuredClone(backing);
		},
		beginWorkspaceRestore: async () => {
			throw Error("must not connect");
		},
		rpc: async (request: { input: { refs: unknown[] } }) => {
			requests.push(request);
			return [];
		},
		browser: {
			history: {},
			navigate: async () => {},
			updatePage: async (input: {
				pane: WorkstationBrowserPane;
				state: { url: string; pageTitle: string; faviconUrl: null };
			}) => {
				updates.push(structuredClone(input));
				const pane = backing.targets[0]!.workspaces[0]!.panes.find(
					(p) => p.kind === "browser",
				);
				if (!pane || pane.kind !== "browser") throw Error("missing browser");
				pane.browser = input.state;
				backing.revision++;
				return { status: "saved", snapshot: structuredClone(backing) };
			},
		},
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(
		({ connection }) =>
			useWorkspaceViews(api, connection, {
				onSkeleton() {},
				onForget() {},
				async onDescriptor() {},
				onError: (message) => errors.push(message),
				getBrowserHomepage,
			}),
		{ initialProps: { connection: descriptor } },
	);
	return {
		descriptor,
		api,
		hook,
		requests,
		saves,
		updates,
		errors,
		backing: () => backing,
	};
}

test("versioned layout changes preserve browsers and send only terminal/chat references to the backend", async () => {
	const f = fixture();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.refreshResources();
	});
	expect(f.requests).toContainEqual(
		expect.objectContaining({
			input: {
				refs: [
					{
						workspaceId: "workspace",
						resourceId: "terminal",
						kind: "terminal",
						executionId: "execution",
					},
				],
			},
		}),
	);
	await act(async () => {
		await f.hook.result.current.newBrowser("workspace");
	});
	expect(f.saves).toHaveLength(1);
	expect(f.saves[0]?.browserLeases).toEqual([
		{ connectionId: "connection", generation: 4 },
	]);
	expect(
		f.backing().targets[0]?.workspaces[0]?.panes.map((p) => p.kind),
	).toEqual(["terminal", "browser", "browser"]);
	expect(f.errors).toEqual([]);
});

test("new browser tabs use the saved homepage through the original URL sanitizer", async () => {
	const f = fixture(() => ({
		ready: true,
		url: "localhost:3000/start?q=hello#part",
	}));
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	await act(async () => {
		await f.hook.result.current.newBrowser("workspace");
	});
	expect(
		f.saves[0]?.view.targets[0]?.workspaces[0]?.panes.at(-1),
	).toMatchObject({
		kind: "browser",
		browser: { url: "http://localhost:3000/start?q=hello#part" },
	});
});

test("page updates coalesce and retain their captured connection when another device is selected", async () => {
	const f = fixture();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const pane = {
		connectionId: "connection",
		generation: 4,
		workspaceId: "workspace",
		paneId: "browser",
		registrationId: "registration",
	};
	act(() => {
		for (const title of ["First", "Second", "Latest 中文 🙂"])
			f.hook.result.current.persistBrowserPage({
				pane,
				resourceId: "page",
				state: {
					url: "https://example.com/next",
					pageTitle: title,
					faviconUrl: null,
				},
			});
	});
	f.hook.rerender({
		connection: { ...f.descriptor, connectionId: "other", generation: 9 },
	});
	await act(async () => {
		await f.hook.result.current.flush();
	});
	expect(f.updates).toEqual([
		{
			pane,
			resourceId: "page",
			state: {
				url: "https://example.com/next",
				pageTitle: "Latest 中文 🙂",
				faviconUrl: null,
			},
		},
	]);
	expect(f.saves).toEqual([]);
	expect(f.errors).toEqual([]);
});

test("a busy page writer keeps only the latest pending state instead of queuing intermediate batches", async () => {
	const f = fixture();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const original = f.api.browser!.updatePage!;
	const started = Promise.withResolvers<void>(),
		released = Promise.withResolvers<void>();
	let calls = 0;
	f.api.browser!.updatePage = async (input) => {
		calls++;
		if (calls === 1) {
			started.resolve();
			await released.promise;
		}
		return original(input);
	};
	const pane = {
		connectionId: "connection",
		generation: 4,
		workspaceId: "workspace",
		paneId: "browser",
		registrationId: "registration",
	};
	const persist = (pageTitle: string) =>
		f.hook.result.current.persistBrowserPage({
			pane,
			resourceId: "page",
			state: { url: "https://example.com/", pageTitle, faviconUrl: null },
		});
	await act(async () => {
		persist("First");
		const first = f.hook.result.current.flush();
		await started.promise;
		persist("Intermediate");
		const second = f.hook.result.current.flush();
		persist("Latest");
		const third = f.hook.result.current.flush();
		released.resolve();
		await Promise.all([first, second, third]);
	});
	expect(calls).toBe(2);
	expect(f.updates).toHaveLength(2);
	expect(f.updates[1]).toMatchObject({ state: { pageTitle: "Latest" } });
});

test("a failed page write rejects the close flush and retains the update for an explicit later flush", async () => {
	const f = fixture();
	await waitFor(() => expect(f.hook.result.current.view?.revision).toBe(1));
	const original = f.api.browser!.updatePage!;
	f.api.browser!.updatePage = async () => {
		throw new Error("Owned SQLite write failed");
	};
	const update = {
		pane: {
			connectionId: "connection",
			generation: 4,
			workspaceId: "workspace",
			paneId: "browser",
			registrationId: "registration",
		},
		resourceId: "page",
		state: {
			url: "https://example.com/",
			pageTitle: "Unsaved title",
			faviconUrl: null,
		},
	};
	act(() => f.hook.result.current.persistBrowserPage(update));
	await act(async () => {
		await expect(f.hook.result.current.flush()).rejects.toThrow(
			"SQLite write failed",
		);
	});
	expect(f.updates).toEqual([]);
	f.api.browser!.updatePage = original;
	await act(async () => {
		await f.hook.result.current.flush();
	});
	expect(f.updates).toEqual([update]);
	expect(f.saves).toEqual([]);
});
