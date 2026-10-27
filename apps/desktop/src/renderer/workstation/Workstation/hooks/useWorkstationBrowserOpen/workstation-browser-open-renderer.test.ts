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
import { validateWorkspaceViewV3, type WorkspaceViewSnapshotV3, type WorkspaceViewInputV3 } from "shared/workspace-view-v3";
import { browserOpenSaveV3Schema } from "shared/workstation-browser-open";
import { mergeLegacyWorkspaceViewAreas } from "../../../../../main/lib/ssh-direct/workspace-view-area-merge";
import { projectBrowserOpenSnapshotV2 } from "../../utils/workspace-browser-open/workspace-browser-open-view-v3";
import { createWorkspacePaneAreas, workspacePaneAreasStructureKey } from "../../utils/workspace-pane-areas/workspace-pane-areas";
function fixture(blockSave = false, rotateConfirmation = false, paneAreas = false, blockAccept = false) {
	const a = crypto.randomUUID(),
		b = crypto.randomUUID(),
		workspaceId = crypto.randomUUID(),
		ready = Promise.withResolvers<void>(),
		renewed = Promise.withResolvers<void>(),
		accepted = Promise.withResolvers<void>(),
		acceptGate = Promise.withResolvers<void>(),
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
	let areaSnapshot: WorkspaceViewSnapshotV3 | undefined, areaReads = 0, areaSaves = 0;
 const areaSaveSettled = Promise.withResolvers<void>();
 if (paneAreas) {
  const { schemaVersion: _, revision, updatedAt, ...view } = snapshot;
  const input: WorkspaceViewInputV3 = structuredClone(view);
  const workspace = input.targets.find(t => t.connectionId === b)?.workspaces[0];
  if (!workspace) throw Error("Missing fixture workspace");
  workspace.panes.push({ paneId: "right-browser", kind: "browser", resourceId: "right-page", pinned: false, browser: { url: "https://right.invalid/", pageTitle: "Right", faviconUrl: null } });
  workspace.paneTabs = [{ tabId: "center-tab", createdAt: 1, activePaneId: "terminal", layout: { type: "pane", paneId: "terminal" } }];
  workspace.activePaneTabId = "center-tab";
  workspace.rightPaneLayout = { version: 1, activeTabId: "right-tab", tabs: [{ tabId: "right-tab", createdAt: 2, activePaneId: "right-browser", layout: { type: "pane", paneId: "right-browser" } }] };
  workspace.layout = { type: "split", axis: "horizontal", ratio: 0.5, first: { type: "pane", paneId: "terminal" }, second: { type: "pane", paneId: "right-browser" } };
  workspace.rightPaneOpen = true; workspace.activePaneArea = "right"; workspace.activePaneId = "right-browser";
  areaSnapshot = { ...validateWorkspaceViewV3(input), schemaVersion: 3, revision, updatedAt };
  snapshot = projectBrowserOpenSnapshotV2(areaSnapshot);
 }
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
			if (areaSnapshot) {
    const { schemaVersion: _, revision: __, updatedAt: ___, ...previous } = areaSnapshot;
    areaSnapshot = { ...mergeLegacyWorkspaceViewAreas(previous, view), schemaVersion: 3, revision: snapshot.revision, updatedAt: snapshot.updatedAt };
    snapshot = projectBrowserOpenSnapshotV2(areaSnapshot);
   }
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
 if (paneAreas) source.saveViewV3 = async value => {
  const parsed = browserOpenSaveV3Schema.parse(value);
  saveStarted.resolve();
  try {
   await saveGate.promise;
   if (!requests.isCurrent(1, value)) throw Error("Browser open scope changed");
   if (!areaSnapshot) throw Error("Missing owned V3 state");
   areaSnapshot = { ...validateWorkspaceViewV3(parsed.save.view), schemaVersion: 3, revision: areaSnapshot.revision + 1, updatedAt: 2 };
   snapshot = projectBrowserOpenSnapshotV2(areaSnapshot); areaSaves++;
   return structuredClone(areaSnapshot);
  } finally { areaSaveSettled.resolve(); }
 };
	const api = {
  ...(paneAreas ? { getWorkspaceViewV3: async () => {
   if (!areaSnapshot) throw Error("Missing owned V3 state");
   areaReads++;
   return { revision: areaSnapshot.revision, snapshot: structuredClone(areaSnapshot), invalid: false, navigationRevision: 0 };
  } } : {}),
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
  paneAreas,
		flush: async () => {},
		enqueue: async (action) => action(),
		accept: () => {
			accepted.resolve();
			if (blockAccept) return acceptGate.promise;
		},
		close: () => {},
		captureShow: () => async () => {
			shows++;
		},
	}));
	if (!blockSave) saveGate.resolve();
	return {
		api,
  areaSnapshot: () => areaSnapshot,
  areaReads: () => areaReads,
  areaSaves: () => areaSaves,
  areaSaveSettled,
		input,
		requests,
		ready,
		renewed,
		accepted,
		acceptGate,
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
			acceptGate.resolve();
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

test("the opt-in V3 renderer saves the center while retaining the active right area", async () => {
	const f = fixture(false, false, true);
	try {
		await f.ready.promise;
		const receipt = f.execute()();
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
		f.registerGate.resolve();
		const result = await receipt;
		expect(f.areaReads()).toBe(1);
		expect(f.reads()).toBe(0);
		expect(f.areaSaves()).toBe(1);
		expect(f.saves()).toBe(0);
		const saved = f
			.areaSnapshot()
			?.targets.find((t) => t.connectionId === f.input.descriptor.connectionId)
			?.workspaces[0];
		expect(saved?.rightPaneLayout?.tabs[0]?.activePaneId).toBe("right-browser");
		expect(saved?.activePaneArea).toBe("right");
		expect(saved?.activePaneId).toBe("right-browser");
		expect(saved?.paneTabs).toHaveLength(2);
		expect(saved?.panes.some((p) => p.paneId === result.paneId)).toBe(true);
		expect(f.terminalCalls()).toBe(0);
	} finally {
		f.close();
	}
});
test("an incomplete V3 API falls back to the original V2 transport", async () => {
	const f = fixture(false, false, true);
	try {
		await f.ready.promise;
		f.api.getWorkspaceViewV3 = undefined;
		const receipt = f.execute()();
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
		f.registerGate.resolve();
		await receipt;
		expect(f.areaReads()).toBe(0);
		expect(f.reads()).toBe(1);
		expect(f.areaSaves()).toBe(0);
		expect(f.saves()).toBe(1);
		expect(
			f
				.areaSnapshot()
				?.targets.find(
					(t) => t.connectionId === f.input.descriptor.connectionId,
				)?.workspaces[0]?.rightPaneLayout?.tabs,
		).toHaveLength(1);
	} finally {
		f.close();
	}
});
test("a structural right-side edit retires an in-flight center open before its V3 save", async () => {
	const f = fixture(true, false, true);
	const workspace = f
		.areaSnapshot()
		?.targets.find((t) => t.connectionId === f.input.descriptor.connectionId)
		?.workspaces[0];
	if (!workspace) throw Error("Missing area workspace");
	const areas = createWorkspacePaneAreas(workspace, {
		scheduleMicrotask: () => {},
	});
	const off = registerWorkstationPaneRuntime(
		f.api,
		f.input.descriptor,
		f.input.workspaceId,
		workspace.tabId,
		{
			read: () => areas.center.getState(),
			replace: (state) => areas.center.getState().replaceState(state),
			subscribe: (listener) => areas.subscribe(listener),
			fingerprint: () => workspacePaneAreasStructureKey(areas.read()),
		},
	);
	try {
		await f.ready.promise;
		const receipt = f
			.execute()()
			.catch((error) => error);
		await f.saveStarted.promise;
		areas.right
			.getState()
			.setPanePinned({ paneId: "right-browser", pinned: true });
		areas.flush();
		await f.completed.promise;
		expect((await receipt).message).toContain("Workspace pane layout changed");
		f.saveGate.resolve();
		await f.areaSaveSettled.promise;
		expect(f.areaSaves()).toBe(0);
		expect(
			f
				.areaSnapshot()
				?.targets.find(
					(t) => t.connectionId === f.input.descriptor.connectionId,
				)?.workspaces[0]?.panes,
		).toHaveLength(2);
	} finally {
		off();
		areas.dispose();
		f.close();
	}
});

test("an asynchronous view refresh must finish before background guest creation and acknowledgement", async () => {
 const f=fixture(false,false,true,true), guestCreated=Promise.withResolvers<Element>();
 const observer=new MutationObserver(()=>{const guest=document.querySelector("webview");if(guest)guestCreated.resolve(guest);});
 observer.observe(document.body,{childList:true,subtree:true});
 try {
 await f.ready.promise;
 const receipt=f.execute()().catch(error=>error);
 await f.accepted.promise;
 expect(document.querySelectorAll("webview")).toHaveLength(0);
 f.acceptGate.resolve();
 const guest=await guestCreated.promise;
 Object.assign(guest,{getWebContentsId:()=>42,executeJavaScript:async()=>{throw Error("No viewport stream in owned unit guest");}});
 guest.dispatchEvent(new Event("dom-ready"));
 await f.registerStarted.promise;f.registerGate.resolve();
 expect((await receipt).paneId).toBeDefined();
 } finally {observer.disconnect();f.close();}
});

test("retiring a main request during an asynchronous view refresh prevents background creation",async()=>{
 const f=fixture(false,false,true,true);
 try {
 await f.ready.promise;const execute=f.execute(),receipt=execute().catch(error=>error);
 await f.accepted.promise;execute.release?.();
 expect((await receipt).message).toContain("released");
 f.acceptGate.resolve();await f.completed.promise;
 expect(document.querySelectorAll("webview")).toHaveLength(0);
 }finally{f.close();}
});
