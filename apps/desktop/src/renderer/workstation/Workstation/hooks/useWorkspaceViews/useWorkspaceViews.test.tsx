import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import type {
	WorkspaceRestoreSnapshot,
	WorkspaceViewSnapshot,
} from "../../../../../shared/workspace-view";
import { useWorkspaceViews } from "./useWorkspaceViews";

afterEach(cleanup);
test("successful manual restore reloads the main process auto-connect decision", async () => {
	const backing: WorkspaceViewSnapshot = {
		schemaVersion: 1,
		revision: 1,
		updatedAt: 1,
		restoreOnLaunch: true,
		activeConnectionId: "mac",
		window: { x: 0, y: 0, width: 1200, height: 900, maximized: false },
		targets: [
			{
				connectionId: "mac",
				targetRevision: 1,
				backendId: "backend",
				namespaceId: "namespace",
				serviceUid: 501,
				autoConnect: false,
				activeTabId: null,
				workspaces: [],
			},
		],
	};
	let receive!: (snapshot: WorkspaceRestoreSnapshot) => void;
	const api = {
		getWorkspaceView: async () => ({
			snapshot: structuredClone(backing),
			revision: backing.revision,
			invalid: false,
			navigationRevision: 0,
		}),
		saveWorkspaceView: async () => backing,
		onWorkspaceRestore: (listener: typeof receive) => {
			receive = listener;
			return () => {};
		},
		beginWorkspaceRestore: async () => ({
			jobId: "job",
			sequence: 1,
			viewRevision: 1,
			navigationRevision: 0,
			connectionId: "mac",
			status: "paused",
			reason: "disconnected",
			resources: [],
		}),
	} as unknown as DirectWorkstationApi;
	const hook = renderHook(() =>
		useWorkspaceViews(api, null, {
			onSkeleton: () => {},
			onForget: () => {},
			onDescriptor: async () => {},
			onError: () => {},
		}),
	);
	await waitFor(() =>
		expect(hook.result.current.view?.targets[0]?.autoConnect).toBe(false),
	);
	backing.targets[0]!.autoConnect = true;
	backing.revision++;
	act(() =>
		receive({
			jobId: "manual",
			sequence: 2,
			viewRevision: 2,
			navigationRevision: 0,
			connectionId: "mac",
			status: "ready",
			resources: [],
			descriptor: {
				connectionId: "mac",
				generation: 1,
				backendId: "backend",
				namespaceId: "namespace",
				instanceId: "new",
				capabilities: { workspaceViewRestoreV1: true },
			},
		}),
	);
	await waitFor(() =>
		expect(hook.result.current.view?.targets[0]?.autoConnect).toBe(true),
	);
});
