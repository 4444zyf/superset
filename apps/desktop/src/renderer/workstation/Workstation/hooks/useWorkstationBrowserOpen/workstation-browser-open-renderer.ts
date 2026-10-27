import type { DirectWorkstationApi } from "shared/direct-workstation";
import type { WorkspaceViewSnapshotV2 } from "shared/workspace-view-v2";
import type {
	WorkstationBrowserOpenEvent,
	WorkstationBrowserOpenIdentity,
	WorkstationBrowserOpenInput,
} from "shared/workstation-browser-open";
import { workstationBrowsers } from "../../providers/WorkstationBrowsers/workstation-browsers";
import { openWorkstationBrowserView } from "../../utils/workspace-browser-open/workspace-browser-open-view";
import {
	openWorkstationBrowserViewV3,
	projectBrowserOpenSnapshotV2,
} from "../../utils/workspace-browser-open/workspace-browser-open-view-v3";
import { captureWorkstationPaneRuntime } from "../../utils/workstation-pane-runtime/workstation-pane-runtime";

interface Dependencies {
	paneAreas?: boolean;
	flush(): Promise<void>;
	enqueue<T>(action: () => Promise<T>): Promise<T>;
	accept(
		snapshot: WorkspaceViewSnapshotV2,
		input: WorkstationBrowserOpenInput,
		show: boolean,
	): void;
	close(
		input: WorkstationBrowserOpenInput,
		paneId: string,
		resourceId: string,
	): void;
	captureShow(
		input: WorkstationBrowserOpenInput,
	): (signal: AbortSignal, current: () => Promise<void>) => Promise<void>;
}
export function startWorkstationBrowserOpenRenderer(
	api: DirectWorkstationApi,
	dependencies: () => Dependencies,
): () => void {
	const source = api.browser?.openRequests;
	if (!source || !api.getWorkspaceViewV2 || !api.browser?.updatePage)
		return () => {};
	const subscriptionId = crypto.randomUUID(),
		pending = new Map<
			string,
			{ identity: WorkstationBrowserOpenIdentity; abort: AbortController }
		>();
	let closed = false,
		preparing = false,
		scopeId: string | undefined,
		observedScope: string | undefined;
	const prepare = async () => {
		if (closed || preparing) return;
		preparing = true;
		try {
			while (!closed) {
				const next = await source.prepare({ subscriptionId });
				if (closed) break;
				scopeId = next.scopeId;
				const ready = await source.confirmReady({ scopeId, subscriptionId });
				if (closed) break;
				if (ready && (!observedScope || observedScope === scopeId)) break;
			}
		} catch {
			scopeId = undefined;
			void source.end({ subscriptionId }).catch(() => {});
		} finally {
			preparing = false;
			if (closed) void source.end({ subscriptionId }).catch(() => {});
		}
	};
	const open = async (
		event: Extract<WorkstationBrowserOpenEvent, { type: "open" }>,
	) => {
		if (
			closed ||
			event.subscriptionId !== subscriptionId ||
			event.scopeId !== scopeId ||
			pending.has(event.id)
		)
			return;
		const identity = { id: event.id, scopeId: event.scopeId, subscriptionId },
			abort = new AbortController(),
			input = event.input;
		pending.set(event.id, { identity, abort });
		let finalized = false,
			stop: () => void = () => {};
		const fail = (error: string) => {
			if (finalized) return;
			finalized = true;
			void source
				.complete({
					...identity,
					ok: false,
					error: error.slice(0, 4096) || "Browser open failed",
				})
				.catch(() => {});
		};
		const current = async () => {
			if (
				closed ||
				abort.signal.aborted ||
				!(await source.isCurrent(identity)) ||
				abort.signal.aborted
			)
				throw Error("Browser open scope changed");
		};
		const show = dependencies().captureShow(input);
		try {
			await dependencies().flush();
			await current();
			await dependencies().enqueue(async () => {
				await current();
				const useAreas = dependencies().paneAreas,
					readV3 = useAreas ? api.getWorkspaceViewV3 : undefined,
					saveV3 = useAreas ? source.saveViewV3 : undefined,
					areaBefore = readV3 && saveV3 ? await readV3.call(api) : null,
					before = areaBefore
						? {
								...areaBefore,
								snapshot: areaBefore.snapshot
									? projectBrowserOpenSnapshotV2(areaBefore.snapshot)
									: null,
							}
						: await api.getWorkspaceViewV2!();
				await current();
				if (before.invalid)
					throw Error("Workspace view storage is unavailable");
				const oldWorkspace = before.snapshot?.targets
					.find(
						(target) => target.connectionId === input.descriptor.connectionId,
					)
					?.workspaces.find(
						(workspace) => workspace.workspaceId === input.workspaceId,
					);
				const runtime = oldWorkspace
					? captureWorkstationPaneRuntime(
							api,
							input.descriptor,
							input.workspaceId,
							oldWorkspace.tabId,
						)
					: null;
				if (runtime)
					stop = runtime.watch(() => {
						abort.abort();
						fail("Workspace pane layout changed");
					});
				const ids = {
					paneId: crypto.randomUUID(),
					resourceId: crypto.randomUUID(),
					tabId: crypto.randomUUID(),
				};
				const openedV3 = areaBefore
					? openWorkstationBrowserViewV3({
							snapshot: areaBefore.snapshot,
							input,
							...ids,
							runtimeState: runtime?.state,
						})
					: null;
				const opened =
					openedV3 ??
					openWorkstationBrowserView({
						snapshot: before.snapshot,
						input,
						...ids,
						runtimeState: runtime?.state,
					});
				await current();
				const save = {
					expectedRevision: before.revision,
					navigationRevision: before.navigationRevision,
					view: opened.view,
					browserLeases: [
						{
							connectionId: input.descriptor.connectionId,
							generation: input.descriptor.generation,
						},
					],
				};
				const saved =
					openedV3 && saveV3
						? projectBrowserOpenSnapshotV2(
								await saveV3.call(source, {
									...identity,
									save: { ...save, view: openedV3.view },
								}),
							)
						: await source.saveView({ ...identity, save });
				await current();
				stop();
				stop = () => {};
				runtime?.apply(opened.state, input.show);
				const browsers = workstationBrowsers(api),
					pane = opened.pane;
				if (pane.kind !== "browser")
					throw Error("Browser pane identity changed");
				const id = browsers.ensure(input.descriptor, input.workspaceId, pane, {
					onPersist: (state) => {
						const registration = browsers.registration(id),
							pageScope = scopeId;
						if (!registration || closed) return;
						void api.browser!.updatePage!({
							pane: registration,
							resourceId: pane.resourceId,
							state,
						})
							.then((result) => {
								if (
									!closed &&
									pageScope === scopeId &&
									observedScope === scopeId &&
									browsers.registration(id) === registration &&
									(result.status === "saved" || result.status === "unchanged")
								)
									dependencies().accept(result.snapshot, input, false);
							})
							.catch(() => {});
					},
					onClose: () =>
						dependencies().close(input, pane.paneId, pane.resourceId),
					onFocus() {},
					onNewWindow() {},
					onFind() {},
					onError() {},
				});
				dependencies().accept(saved, input, input.show);
				await browsers.openBackground(id, abort.signal);
				await current();
				if (input.show) {
					await show(abort.signal, current);
					await current();
				}
				if (!finalized) {
					finalized = true;
					await source.complete({
						...identity,
						ok: true,
						result: {
							paneId: pane.paneId,
							url: input.url,
							title: browsers.state.getState(id).pageTitle.slice(0, 4096),
						},
					});
				}
			});
		} catch (error) {
			fail(error instanceof Error ? error.message : "Browser open failed");
		} finally {
			stop();
			pending.delete(event.id);
		}
	};
	const offEvent = source.onEvent((event) => {
		if (event.type === "open") {
			void open(event);
			return;
		}
		const job = pending.get(event.id);
		if (
			job &&
			job.identity.scopeId === event.scopeId &&
			job.identity.subscriptionId === event.subscriptionId
		)
			job.abort.abort();
	});
	const offAvailability = source.onAvailability((event) => {
		observedScope = event.scopeId;
		if (!closed && scopeId && observedScope !== scopeId) void prepare();
	});
	void prepare();
	return () => {
		closed = true;
		offEvent();
		offAvailability();
		for (const job of pending.values()) job.abort.abort();
		void source.end({ subscriptionId }).catch(() => {});
	};
}
