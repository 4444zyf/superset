import { expect, test } from "bun:test";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import { currentWorkstationBrowserBridgePanes } from "./workstation-browser-bridge-panes";

function fixture() {
	const descriptor: DirectDescriptor = {
		connectionId: "connection",
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	};
	const pane: WorkstationBrowserPane = {
		connectionId: "connection",
		generation: 1,
		workspaceId: "owned",
		paneId: "page",
		registrationId: "registration",
	};
	let current = true,
		key: string | null = "original-key";
	const calls: boolean[] = [];
	const makeGuest = () => ({
		getURL: () => "",
		getTitle: () => "",
		isLoading: () => false,
		isDestroyed: () => false,
		reload: () => calls.push(false),
		reloadIgnoringCache: () => calls.push(true),
	});
	let guest = makeGuest();
	const source = currentWorkstationBrowserBridgePanes({
		ownerId: 7,
		descriptor,
		isCurrent: () => current,
		registry: {
			listRegistrations: (owner, target, workspace) =>
				owner === 7 &&
				target.backendId === descriptor.backendId &&
				workspace === pane.workspaceId
					? [{ ...pane }]
					: [],
			getManagerPaneId: (owner, input) =>
				owner === 7 &&
				(input as WorkstationBrowserPane).registrationId === pane.registrationId
					? key
					: null,
		},
		manager: {
			getWebContents: () => guest,
			capturePng: async () => "",
			evaluateJS: async () => null,
			getConsoleLogs: () => [],
		},
		canonical: (_owner, _pane, url) => url,
	});
	return {
		source,
		calls,
		retire: () => {
			current = false;
		},
		replace: () => {
			key = "new-key";
		},
		replaceGuest: () => {
			guest = makeGuest();
		},
		destroyGuest: () => {
			guest.isDestroyed = () => true;
		},
	};
}
test("reload pins the actual guest and dispatches the chosen original cache method once", async () => {
	for (const hard of [false, true]) {
		const f = fixture(),
			reload = f.source.pinReload("page", "owned", hard);
		expect(f.calls).toEqual([]);
		expect(await reload()).toEqual({ ok: true });
		expect(f.calls).toEqual([hard]);
		await expect(reload()).rejects.toThrow("already dispatched");
		expect(f.calls).toEqual([hard]);
	}
});
test("a pinned reload cannot run on another owner, registration or guest", async () => {
	for (const action of [
		"retire",
		"replace",
		"replaceGuest",
		"destroyGuest",
	] as const) {
		const f = fixture(),
			reload = f.source.pinReload("page", "owned", false);
		f[action]();
		await expect(reload()).rejects.toThrow();
		expect(f.calls).toEqual([]);
	}
});
test("reload rejects a foreign workspace before dispatch", () => {
	const f = fixture();
	expect(() => f.source.pinReload("page", "other", false)).toThrow(
		"No live pane",
	);
	expect(f.calls).toEqual([]);
});
