import type { WorkspaceState } from "@superset/panes";
import { preserveLocalPaneSelection } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/utils/preserveLocalPaneSelection";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { WorkspacePaneV2 } from "shared/workspace-view-v2";
import type { WorkspacePaneAreasState } from "../workspace-pane-areas/workspace-pane-areas";
type State = WorkspaceState<WorkspacePaneV2>;
interface Port {
	read(): State;
	readAreas?(): WorkspacePaneAreasState;
	fingerprint?(): string;
	flush?(): Promise<void>;
	replace(state: State): void;
	subscribe(listener: () => void): () => void;
}
interface Entry {
	port: Port;
	listeners: Set<() => void>;
	off(): void;
}
const scopes = new WeakMap<DirectWorkstationApi, Map<string, Entry>>();
const key = (
	descriptor: DirectDescriptor,
	workspaceId: string,
	tabId: string,
) =>
	JSON.stringify([
		descriptor.connectionId,
		descriptor.generation,
		descriptor.backendId,
		descriptor.namespaceId,
		descriptor.instanceId,
		workspaceId,
		tabId,
	]);
function structure(state: State): string {
	return JSON.stringify(
		state.tabs.map((tab) => [
			tab.id,
			tab.titleOverride,
			tab.createdAt,
			tab.layout,
			Object.values(tab.panes)
				.sort((a, b) => a.id.localeCompare(b.id))
				.map((pane) => [
					pane.id,
					pane.kind,
					pane.data.resourceId,
					pane.data.executionId,
					pane.titleOverride,
					pane.pinned,
				]),
		]),
	);
}
function readFingerprint(port: Port, state = port.read()): string {
	return port.fingerprint?.() ?? structure(state);
}
export { structure as workstationPaneRuntimeStructure };
export function preserveRuntimePanePins(previous: State, next: State): State {
	const old = new Map(
		previous.tabs
			.flatMap((tab) => Object.values(tab.panes))
			.map((pane) => [pane.id, pane]),
	);
	return {
		...next,
		tabs: next.tabs.map((tab) => ({
			...tab,
			panes: Object.fromEntries(
				Object.entries(tab.panes).map(([id, pane]) => {
					const before = old.get(id);
					return [
						id,
						before &&
						before.kind === pane.kind &&
						before.data.resourceId === pane.data.resourceId &&
						before.pinned !== undefined
							? { ...pane, pinned: before.pinned }
							: pane,
					];
				}),
			),
		})),
	};
}
export function registerWorkstationPaneRuntime(
	api: DirectWorkstationApi,
	descriptor: DirectDescriptor,
	workspaceId: string,
	tabId: string,
	port: Port,
): () => void {
	let entries = scopes.get(api);
	if (!entries) {
		entries = new Map();
		scopes.set(api, entries);
	}
	const scope = key(descriptor, workspaceId, tabId),
		old = entries.get(scope);
	if (!old && entries.size >= 128)
		throw Error("Workspace pane runtime limit exceeded");
	const retire = (entry: Entry) => {
		entry.off();
		for (const listener of [...entry.listeners]) listener();
		entry.listeners.clear();
	};
	if (old) {
		entries.delete(scope);
		retire(old);
	}
	const listeners = new Set<() => void>(),
		entry: Entry = { port, listeners, off: () => {} };
	let previous = readFingerprint(port);
	entry.off = port.subscribe(() => {
		const next = readFingerprint(port);
		if (next === previous) return;
		previous = next;
		for (const listener of [...listeners]) listener();
	});
	entries.set(scope, entry);
	return () => {
		if (entries!.get(scope) !== entry) return;
		entries!.delete(scope);
		retire(entry);
	};
}
export function captureWorkstationPaneRuntime(
	api: DirectWorkstationApi,
	descriptor: DirectDescriptor,
	workspaceId: string,
	tabId: string,
) {
	const entries = scopes.get(api),
		scope = key(descriptor, workspaceId, tabId),
		entry = entries?.get(scope);
	if (!entry) return null;
	const previous = entry.port.read(),
		fingerprint = readFingerprint(entry.port, previous);
	const current = () => entries!.get(scope) === entry;
	const unchanged = () =>
		current() && readFingerprint(entry.port) === fingerprint;
	return {
		state: previous,
		areas: entry.port.readAreas?.(),
		isCurrent: current,
		unchanged,
		watch(listener: () => void) {
			if (!current()) {
				listener();
				return () => {};
			}
			entry.listeners.add(listener);
			return () => {
				entry.listeners.delete(listener);
			};
		},
		apply(next: State, show = false) {
			if (!unchanged()) throw Error("Workspace pane layout changed");
			entry.port.replace(
				show ? next : preserveLocalPaneSelection(entry.port.read(), next),
			);
		},
	};
}

export async function flushWorkstationPaneRuntimes(
	api: DirectWorkstationApi,
): Promise<void> {
	const entries = scopes.get(api);
	if (!entries) return;
	const results = await Promise.allSettled(
		Array.from(entries.values(), (entry) => {
			try {
				return entry.port.flush?.() ?? Promise.resolve();
			} catch (error) {
				return Promise.reject(error);
			}
		}),
	);
	for (const result of results)
		if (result.status === "rejected") throw result.reason;
}
