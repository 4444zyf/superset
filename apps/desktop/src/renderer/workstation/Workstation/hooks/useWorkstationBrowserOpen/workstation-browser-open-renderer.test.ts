import { createWorkspaceStore } from "@superset/panes";
import { toPaneState } from "../../utils/pane-adapter/pane-adapter";
import { registerWorkstationPaneRuntime } from "../../utils/workstation-pane-runtime/workstation-pane-runtime";
import { expect, test } from "bun:test";
import { WorkstationBrowserOpenRequests } from "../../../../../main/lib/ssh-direct/workstation-browser-open-requests";
import type { DirectWorkstationApi } from "shared/direct-workstation";
import type {
	WorkstationBrowserOpenEvent,
	WorkstationBrowserOpenAvailability,
	WorkstationBrowserOpenInput,
	WorkstationBrowserOpenApi,
} from "shared/workstation-browser-open";
import {
	browserOpenReplySchema,
	browserOpenSaveSchema,
} from "shared/workstation-browser-open";
import type { WorkstationBrowserRegistration } from "shared/workstation-browser";
import { emptyWorkspaceView } from "shared/workspace-view";
import {
	validateWorkspaceViewV2,
	type WorkspaceViewSnapshotV2,
} from "shared/workspace-view-v2";
import { workstationBrowsers } from "../../providers/WorkstationBrowsers/workstation-browsers";
import { startWorkstationBrowserOpenRenderer } from "./workstation-browser-open-renderer";
function fixture(blockSave = false, rotateConfirmation = false) {
	const a = crypto.randomUUID(),
		b = crypto.randomUUID(),
		workspaceId = crypto.randomUUID(),
		ready = Promise.withResolvers<void>(),
		renewed = Promise.withResolvers<void>(),
		accepted = Promise.withResolvers<void>(),
		saveStarted = Promise.withResolvers<void>(),
		saveGate = Promise.withResolvers<void>(),
		registerStarted = Promise.withResolvers<void>(),
		registerGate = Promise.withResolvers<void>(),
		completed = Promise.withResolvers<void>();
	const input: WorkstationBrowserOpenInput = {
		descriptor: {
			connectionId: b,
			generation: 1,
			backendId: b,
			namespaceId: "namespace",
			instanceId: "instance",
		},
		workspaceId,
		projectId: null,
		workspaceName: "Owned",
		url: "https://owned.invalid/",
		target: "new-tab",
		show: false,
	};
	const target = (id: string) => ({
		connectionId: id,
		targetRevision: 1,
		backendId: id,
		namespaceId: "namespace",
		serviceUid: 1000,
		autoConnect: true,
		activeTabId: "workspace-tab",
		workspaces: [
			{
				tabId: "workspace-tab",
				workspaceId,
				activeTool: "terminal" as const,
				activePaneId: "terminal",
				panes: [
					{
						kind: "terminal" as const,
						paneId: "terminal",
						resourceId: "pty",
						executionId: "execution",
					},
				],
				layout: { type: "pane" as const, paneId: "terminal" },
			},
		],
	});
	let snapshot: WorkspaceViewSnapshotV2 = {
		...emptyWorkspaceView({
			x: 0,
			y: 0,
			width: 1200,
			height: 850,
			maximized: false,
		}),
		schemaVersion: 2,
		revision: 1,
		updatedAt: 1,
		activeConnectionId: a,
		targets: [target(a), target(b)],
	};
	let onEvent: ((event: WorkstationBrowserOpenEvent) => void) | undefined,
		onAvailability:
			| ((event: WorkstationBrowserOpenAvailability) => void)
			| undefined,
		confirmations = 0,
		reads = 0,
		shows = 0,
		terminalCalls = 0,
		saves = 0;
	const registrations: WorkstationBrowserRegistration[] = [];
	const requests = new WorkstationBrowserOpenRequests({
		getOwner: () => ({ ownerId: 1, ownerEpoch: 1 }),
		dispatch: (_owner, event) => onEvent?.(event),
		changed: () => onAvailability?.(requests.availability()),
		schedule: () => () => {},
		validateResult: (value, result) =>
			result.url === value.url &&
			registrations.some(
				(p) =>
					p.paneId === result.paneId &&
					p.connectionId === value.descriptor.connectionId &&
					p.generation === value.descriptor.generation &&
					p.workspaceId === value.workspaceId,
			),
	});
	const source: WorkstationBrowserOpenApi = {
		prepare: async (value) => requests.prepare(1, value.subscriptionId),
		confirmReady: async (value) => {
			const result = requests.confirmReady(1, value);
			confirmations++;
			if (confirmations === 1 && rotateConfirmation) requests.invalidate();
			if (confirmations === 1) ready.resolve();
			else renewed.resolve();
			return result;
		},
		end: async (value) => requests.end(1, value.subscriptionId),
		complete: async (value) => {
			const result = requests.complete(1, browserOpenReplySchema.parse(value));
			completed.resolve();
			return result;
		},
		isCurrent: async (value) => requests.isCurrent(1, value),
		saveView: async (value) => {
			const parsed = browserOpenSaveSchema.parse(value);
			saveStarted.resolve();
			await saveGate.promise;
			if (!requests.isCurrent(1, value))
				throw Error("Browser open scope changed");
			const view = validateWorkspaceViewV2(parsed.save.view);
			snapshot = {
				...view,
				schemaVersion: 2,
				revision: snapshot.revision + 1,
				updatedAt: 2,
			};
			saves++;
			return structuredClone(snapshot);
		},
		onEvent: (listener) => {
			onEvent = listener;
			return () => {
				onEvent = undefined;
			};
		},
		onAvailability: (listener) => {
			onAvailability = listener;
			return () => {
				onAvailability = undefined;
			};
		},
	};
	const api = {
		getWorkspaceViewV2: async () => {
			reads++;
			return {
				revision: snapshot.revision,
				snapshot: structuredClone(snapshot),
				invalid: false,
				navigationRevision: 0,
			};
		},
		rpc: async () => {
			terminalCalls++;
			throw Error("Unexpected resource creation");
		},
		browser: {
			openRequests: source,
			register: async (value: WorkstationBrowserRegistration) => {
				registrations.push(value);
				registerStarted.resolve();
				await registerGate.promise;
			},
			unregister: async () => {},
			navigate: async () => ({ status: "navigated" }),
			updatePage: async () => ({
				status: "unchanged",
				snapshot: structuredClone(snapshot),
			}),
			onEvent: () => () => {},
		},
	} as unknown as DirectWorkstationApi;
	const stop = startWorkstationBrowserOpenRenderer(api, () => ({
		flush: async () => {},
		enqueue: async (action) => action(),
		accept: () => {
			accepted.resolve();
		},
		close: () => {},
		captureShow: () => async () => {
			shows++;
		},
	}));
	if (!blockSave) saveGate.resolve();
	return {
		api,
		input,
		requests,
		ready,
		renewed,
		accepted,
		saveStarted,
		saveGate,
		registerStarted,
		registerGate,
		completed,
		snapshot: () => snapshot,
		reads: () => reads,
		shows: () => shows,
		saves: () => saves,
		terminalCalls: () => terminalCalls,
		execute: (show = false) =>
			requests.pin(
				{ ...input, show },
				requests.availability().scopeId,
				() => true,
			),
		close() {
			saveGate.resolve();
			registerGate.resolve();
			stop();
			requests.dispose();
			const containers = [...document.querySelectorAll("webview")].map(
				(guest) => guest.parentElement,
			);
			workstationBrowsers(api).clear();
			for (const container of containers) container?.remove();
		},
	};
}
test("the renderer acknowledges a background open only after actual main registration without creating a terminal", async () => {
	const f = fixture();
	try {
		await f.ready.promise;
		const execute = f.execute();
		let done = false;
		const receipt = execute().then((value) => {
			done = true;
			return value;
		});
		await f.accepted.promise;
		const guest = [...document.querySelectorAll("webview")].at(-1);
		if (!guest) throw Error("Missing background guest");
		Object.assign(guest, {
			getWebContentsId: () => 42,
			executeJavaScript: async () => {
				throw Error("No viewport stream in owned unit guest");
			},
		});
		guest.dispatchEvent(new Event("dom-ready"));
		await f.registerStarted.promise;
		expect(done).toBe(false);
		expect(f.requests.availability().accepting).toBe(false);
		expect(f.terminalCalls()).toBe(0);
		f.registerGate.resolve();
		const result = await receipt;
		expect(result.url).toBe(f.input.url);
		expect(
			f
				.snapshot()
				.targets[1]?.workspaces[0]?.panes.some(
					(p) => p.paneId === result.paneId,
				),
		).toBe(true);
		expect(f.snapshot().activeConnectionId).not.toBe(
			f.input.descriptor.connectionId,
		);
		expect(f.shows()).toBe(0);
		expect(f.saves()).toBe(1);
	} finally {
		f.close();
	}
});
test("a released main request cannot commit after the original save check finishes", async () => {
	const f = fixture(true);
	try {
		await f.ready.promise;
		const execute = f.execute(),
			receipt = execute().catch((error) => error);
		await f.saveStarted.promise;
		execute.release?.();
		expect((await receipt).message).toContain("released");
		f.saveGate.resolve();
		await f.completed.promise;
		expect(f.saves()).toBe(0);
		expect(
			f.snapshot().targets[1]?.workspaces[0]?.panes.map((p) => p.kind),
		).toEqual(["terminal"]);
		expect(f.terminalCalls()).toBe(0);
	} finally {
		f.close();
	}
});
test("a new scope renews renderer readiness without replaying any browser intent", async () => {
	const f = fixture();
	try {
		await f.ready.promise;
		const old = f.requests.availability().scopeId;
		f.requests.invalidate();
		await f.renewed.promise;
		expect(f.requests.availability().scopeId === old).toBe(false);
		expect(f.requests.availability().ready).toBe(true);
		expect(f.reads()).toBe(0);
		expect(f.saves()).toBe(0);
		expect(f.terminalCalls()).toBe(0);
	} finally {
		f.close();
	}
});

test("a pin change cancels the actual pending main request before its guarded save can commit", async () => {
	const f = fixture(true),
		workspace = f.snapshot().targets[1]!.workspaces[0]!,
		store = createWorkspaceStore({ initialState: toPaneState(workspace) });
	const off = registerWorkstationPaneRuntime(
		f.api,
		f.input.descriptor,
		f.input.workspaceId,
		workspace.tabId,
		{
			read: () => store.getState(),
			replace: (state) => store.getState().replaceState(state),
			subscribe: (listener) => store.subscribe(listener),
		},
	);
	try {
		await f.ready.promise;
		const receipt = f
			.execute()()
			.catch((error) => error);
		await f.saveStarted.promise;
		store.getState().setPanePinned({ paneId: "terminal", pinned: true });
		expect((await receipt).message).toContain("layout changed");
		expect(f.saves()).toBe(0);
		f.saveGate.resolve();
	} finally {
		off();
		f.close();
	}
});
test("an explicit show request selects the saved browser after registration without creating a terminal", async () => {
	const f = fixture();
	try {
		await f.ready.promise;
		const receipt = f.execute(true)();
		await f.accepted.promise;
		const guest = [...document.querySelectorAll("webview")].at(-1);
		if (!guest) throw Error("Missing background guest");
		Object.assign(guest, {
			getWebContentsId: () => 43,
			executeJavaScript: async () => {
				throw Error("No viewport stream in owned unit guest");
			},
		});
		guest.dispatchEvent(new Event("dom-ready"));
		await f.registerStarted.promise;
		f.registerGate.resolve();
		await receipt;
		expect(f.shows()).toBe(1);
		expect(f.snapshot().activeConnectionId).toBe(
			f.input.descriptor.connectionId,
		);
		expect(f.terminalCalls()).toBe(0);
	} finally {
		f.close();
	}
});
test("a scope changed during confirmation is re-established before advertising renderer readiness", async () => {
	const f = fixture(false, true);
	try {
		await f.renewed.promise;
		expect(f.requests.availability().ready).toBe(true);
		expect(f.reads()).toBe(0);
		expect(f.saves()).toBe(0);
	} finally {
		f.close();
	}
});
