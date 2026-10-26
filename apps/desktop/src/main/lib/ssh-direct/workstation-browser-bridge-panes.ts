import type { BrowserBridgeManager } from "../browser/browser-bridge-http";
import type { BrowserPaneInfo } from "../browser/browser-manager";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import type { WorkstationBrowserRegistry } from "./workstation-browser-registry";

interface Dependencies {
	ownerId: number;
	descriptor: DirectDescriptor;
	isCurrent(): boolean;
	registry: Pick<
		WorkstationBrowserRegistry,
		"listRegistrations" | "getManagerPaneId"
	>;
	manager: Pick<
		BrowserBridgeManager,
		"capturePng" | "evaluateJS" | "getConsoleLogs"
	> & {
		getWebContents(
			paneId: string,
			workspaceId: string,
		): Pick<Electron.WebContents, "getURL" | "getTitle" | "isLoading"> | null;
	};
	normalizePng?(base64: string): string;
	canonical(ownerId: number, pane: WorkstationBrowserPane, raw: string): string;
}

export function currentWorkstationBrowserBridgePanes({
	ownerId,
	descriptor,
	isCurrent,
	registry,
	manager,
	canonical,
	normalizePng,
}: Dependencies) {
	const target = { ...descriptor };
	const assertCurrent = () => {
		if (!isCurrent()) throw Error("Browser bridge is no longer current");
	};
	const assertPinned = (pane: WorkstationBrowserPane, key: string) => {
		assertCurrent();
		if (registry.getManagerPaneId(ownerId, pane) !== key)
			throw Error("Browser pane is no longer current");
	};
	const pin = (pane: WorkstationBrowserPane) => {
		assertCurrent();
		const key = registry.getManagerPaneId(ownerId, pane);
		if (!key) throw Error("Browser pane is no longer current");
		return { pane, key };
	};
	const requirePane = (paneId: string, workspaceId?: string) => {
		assertCurrent();
		if (!workspaceId) throw Error("workspaceId is required");
		const pane = registry
			.listRegistrations(ownerId, target, workspaceId)
			.find((candidate) => candidate.paneId === paneId);
		if (!pane) throw Error(`No live pane ${paneId} in this workspace`);
		return pin(pane);
	};
	return {
		listPanes(workspaceId?: string): BrowserPaneInfo[] {
			assertCurrent();
			const pins = registry
				.listRegistrations(ownerId, target, workspaceId)
				.map(pin);
			const rows: BrowserPaneInfo[] = [];
			for (const { pane, key } of pins) {
				const guest = manager.getWebContents(key, pane.workspaceId);
				assertPinned(pane, key);
				if (!guest) continue;
				rows.push({
					paneId: pane.paneId,
					workspaceId: pane.workspaceId,
					url: canonical(ownerId, pane, guest.getURL()),
					title: guest.getTitle(),
					isLoading: guest.isLoading(),
				});
			}
			assertCurrent();
			for (const { pane, key } of pins) assertPinned(pane, key);
			return rows;
		},
		async capturePng(paneId: string, workspaceId?: string): Promise<string> {
			const { pane, key } = requirePane(paneId, workspaceId);
			const result = await manager.capturePng(key, pane.workspaceId);
			const png = normalizePng ? normalizePng(result) : result;
			assertPinned(pane, key);
			return png;
		},
		async evaluateJS(
			paneId: string,
			code: string,
			workspaceId?: string,
		): Promise<unknown> {
			const { pane, key } = requirePane(paneId, workspaceId);
			const result = await manager.evaluateJS(key, code, pane.workspaceId);
			assertPinned(pane, key);
			return result;
		},
		getConsoleLogs(paneId: string, workspaceId?: string) {
			const { pane, key } = requirePane(paneId, workspaceId);
			const result = manager.getConsoleLogs(key, pane.workspaceId);
			assertPinned(pane, key);
			return result.map((entry) => ({ ...entry }));
		},
	};
}
