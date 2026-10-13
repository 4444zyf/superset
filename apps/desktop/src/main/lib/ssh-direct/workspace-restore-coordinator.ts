import { randomUUID } from "node:crypto";
import { DirectConnectionError } from "@superset/direct-connection";
import type {
	ConnectionProfile,
	ConnectionRegistry,
	ConnectionLease,
} from "@superset/direct-connection";
import type {
	RestoreResourceCheck,
	RestoreResourceRef,
} from "@superset/shared/workspace-restore";
import type {
	DirectDescriptor,
	DirectRpc,
} from "../../../shared/direct-workstation";
import {
	emptyWorkspaceView,
	validateWorkspaceView,
	type WorkspaceViewInput,
	type WorkspaceRestoreSnapshot,
	type TargetView,
} from "../../../shared/workspace-view";
import type { WorkspaceViewStore } from "./workspace-view-store";

interface RestoreManager {
	getLease(id: string): ConnectionLease | null;
	getStatus(id: string): { generation: number; state: string };
	connect(
		id: string,
		options: { mode: "restore-existing" },
	): Promise<ConnectionLease>;
	disconnect(id: string): void;
}
interface RestoreController {
	describe(id: string): DirectDescriptor;
	features(
		id: string,
		refresh?: boolean,
	): Promise<Pick<DirectDescriptor, "capabilities" | "chatHarnesses">>;
	invoke(input: DirectRpc): Promise<unknown>;
	inspectPending(id: string): Promise<unknown[]>;
}
interface RestoreJob {
	owner: number;
	ownerEpoch: number;
	reason: "launch" | "manual";
	snapshot: WorkspaceRestoreSnapshot;
	ownedGeneration?: number;
	pending?: Promise<void>;
	timer?: ReturnType<typeof setTimeout>;
}
const refsFor = (target: TargetView): RestoreResourceRef[] =>
	target.workspaces.flatMap((w) =>
		w.panes.map((p) => ({
			workspaceId: w.workspaceId,
			resourceId: p.resourceId,
			kind: p.kind,
			...(p.executionId ? { executionId: p.executionId } : {}),
		})),
	);
const refKey = (r: RestoreResourceRef) =>
	JSON.stringify([r.workspaceId, r.kind, r.resourceId, r.executionId]);
const sameIdentity = (
	target: TargetView,
	profile: ConnectionProfile,
	revision: number | null,
) =>
	target.targetRevision === revision &&
	target.backendId === profile.backendId &&
	target.namespaceId === profile.namespaceId &&
	target.serviceUid === profile.serviceUid;

export class WorkspaceRestoreCoordinator {
	private owner: number | null = null;
	private ownerEpoch = 0;
	private navigationRevision = 0;
	private job: RestoreJob | null = null;
	private writes: Promise<unknown> = Promise.resolve();
	private readonly explicitConnections = new Set<string>();
	constructor(
		private readonly options: {
			store: WorkspaceViewStore;
			registry: Pick<ConnectionRegistry, "get" | "getTargetRevision">;
			manager: RestoreManager;
			controller: RestoreController;
			window(): WorkspaceViewInput["window"];
			notify(snapshot: WorkspaceRestoreSnapshot): void;
			onReady?(descriptor: DirectDescriptor): void;
			timeoutMs?: number;
			wait?(ms: number): Promise<void>;
		},
	) {}
	activateOwner(owner: number | null): void {
		this.invalidate();
		this.owner = owner;
		this.ownerEpoch++;
		this.navigationRevision = 0;
		this.options.store.activateOwner(owner === null ? null : String(owner));
		if (owner !== null) {
			try {
				const saved = this.options.store.read();
				if (
					saved.snapshot &&
					saved.snapshot.targets.some(
						(t) =>
							!this.options.registry.get(t.connectionId) ||
							this.options.registry.get(t.connectionId)?.kind === "local",
					)
				) {
					const {
						schemaVersion: _,
						revision: __,
						updatedAt: ___,
						...view
					} = saved.snapshot;
					view.targets = view.targets.filter((t) => {
						const p = this.options.registry.get(t.connectionId);
						return !!p && p.kind !== "local";
					});
					if (
						!view.targets.some(
							(t) => t.connectionId === view.activeConnectionId,
						)
					)
						view.activeConnectionId = null;
					this.options.store.save({
						owner: String(owner),
						expectedRevision: saved.revision,
						view,
					});
				}
			} catch {}
		}
	}
	read() {
		try {
			return {
				...this.options.store.read(),
				navigationRevision: this.navigationRevision,
			};
		} catch {
			return {
				revision: 0,
				snapshot: null,
				invalid: true,
				navigationRevision: this.navigationRevision,
			};
		}
	}
	get(): WorkspaceRestoreSnapshot | null {
		return this.job?.ownerEpoch === this.ownerEpoch
			? structuredClone(this.job.snapshot)
			: null;
	}
	private assertOwner(owner: number, epoch = this.ownerEpoch): void {
		if (this.owner !== owner || epoch !== this.ownerEpoch)
			throw new Error("Workspace view owner changed");
	}
	private acceptNavigation(owner: number, revision: number): void {
		this.assertOwner(owner);
		if (!Number.isSafeInteger(revision) || revision < this.navigationRevision)
			throw new Error("Workspace navigation changed");
		if (revision > this.navigationRevision) {
			this.invalidate();
			this.navigationRevision = revision;
		}
	}
	private enqueue<T>(action: () => Promise<T> | T): Promise<T> {
		const result = this.writes.then(action);
		this.writes = result.catch(() => {});
		return result;
	}
	async idle(): Promise<void> {
		await this.writes;
		await this.job?.pending;
	}
	async flushWrites(): Promise<void> {
		await this.writes;
	}
	private current(job: RestoreJob): boolean {
		return (
			this.job === job &&
			this.owner === job.owner &&
			this.ownerEpoch === job.ownerEpoch &&
			job.snapshot.navigationRevision === this.navigationRevision &&
			!["cancelled", "paused"].includes(job.snapshot.status)
		);
	}
	private emit(
		job: RestoreJob,
		change: Partial<WorkspaceRestoreSnapshot>,
	): void {
		if (
			this.job !== job ||
			this.owner !== job.owner ||
			this.ownerEpoch !== job.ownerEpoch
		)
			return;
		Object.assign(job.snapshot, change);
		job.snapshot.sequence++;
		this.options.notify(structuredClone(job.snapshot));
	}
	private release(job: RestoreJob): void {
		const id = job.snapshot.connectionId;
		if (
			id &&
			job.ownedGeneration !== undefined &&
			this.options.manager.getStatus(id).generation === job.ownedGeneration
		)
			this.options.manager.disconnect(id);
		job.ownedGeneration = undefined;
	}
	invalidate(): void {
		const job = this.job;
		if (!job || !["connecting", "checking"].includes(job.snapshot.status))
			return;
		clearTimeout(job.timer);
		this.emit(job, { status: "cancelled" });
		this.release(job);
	}
	cancel(owner: number, jobId: string): void {
		this.assertOwner(owner);
		if (this.job?.snapshot.jobId === jobId) this.invalidate();
	}
	begin(
		owner: number,
		input: { reason: "launch" | "manual"; navigationRevision: number },
	): WorkspaceRestoreSnapshot {
		this.acceptNavigation(owner, input.navigationRevision);
		const saved = this.options.store.read();
		if (
			this.job?.owner === owner &&
			this.job.ownerEpoch === this.ownerEpoch &&
			this.job.snapshot.viewRevision === saved.revision &&
			this.job.snapshot.navigationRevision === input.navigationRevision &&
			(input.reason === "launch" ||
				["connecting", "checking"].includes(this.job.snapshot.status))
		)
			return this.get()!;
		this.invalidate();
		const view = saved.snapshot;
		const target = view?.targets.find(
			(t) => t.connectionId === view.activeConnectionId,
		);
		const profile = target
			? this.options.registry.get(target.connectionId)
			: null;
		const paused = saved.invalid
			? "invalid-view"
			: !view ||
					!target ||
					(input.reason === "launch" &&
						(!view.restoreOnLaunch || !target.autoConnect))
				? "disconnected"
				: !profile ||
						profile.kind === "local" ||
						!sameIdentity(
							target,
							profile,
							this.options.registry.getTargetRevision(target.connectionId),
						)
					? "target-changed"
					: undefined;
		const job: RestoreJob = {
			owner,
			ownerEpoch: this.ownerEpoch,
			reason: input.reason,
			snapshot: {
				jobId: randomUUID(),
				sequence: 1,
				viewRevision: saved.revision,
				navigationRevision: input.navigationRevision,
				connectionId: target?.connectionId ?? null,
				status: paused ? "paused" : "connecting",
				...(paused ? { reason: paused } : {}),
				resources: [],
			},
		};
		this.job = job;
		this.options.notify(structuredClone(job.snapshot));
		if (paused || !target) return this.get()!;
		job.pending = this.run(job, target).finally(() => clearTimeout(job.timer));
		job.timer = setTimeout(() => {
			if (this.current(job)) {
				this.emit(job, { status: "paused", reason: "unavailable" });
				this.release(job);
			}
		}, this.options.timeoutMs ?? 30000);
		return this.get()!;
	}
	private async run(job: RestoreJob, target: TargetView): Promise<void> {
		const id = target.connectionId;
		try {
			const lease = await this.connectExisting(job, id);
			this.emit(job, {
				authenticatedAt: performance.timeOrigin + performance.now(),
			});
			if (!this.current(job)) {
				this.release(job);
				return;
			}
			if (
				lease.backendId !== target.backendId ||
				lease.namespaceId !== target.namespaceId
			) {
				this.emit(job, { status: "paused", reason: "identity-changed" });
				this.release(job);
				return;
			}
			const profile = this.options.registry.get(id);
			if (
				!profile ||
				!sameIdentity(
					target,
					profile,
					this.options.registry.getTargetRevision(id),
				)
			) {
				this.emit(job, { status: "paused", reason: "identity-changed" });
				this.release(job);
				return;
			}
			const descriptor = {
				...this.options.controller.describe(id),
				...(await this.options.controller.features(id, true)),
			};
			if (!this.current(job)) {
				this.release(job);
				return;
			}
			if (!descriptor.capabilities?.workspaceViewRestoreV1) {
				this.emit(job, { status: "paused", reason: "unsupported" });
				this.release(job);
				return;
			}
			this.emit(job, { status: "checking", descriptor });
			const refs = refsFor(target);
			const [resources] = await Promise.all([
				this.options.controller.invoke({
					connectionId: id,
					generation: descriptor.generation,
					path: "workspace.restoreResources",
					type: "query",
					input: { refs },
				}) as Promise<RestoreResourceCheck[]>,
				this.options.controller.inspectPending(id),
			]);
			if (!this.current(job)) {
				this.release(job);
				return;
			}
			if (
				this.options.manager.getLease(id)?.generation !== descriptor.generation
			)
				throw new Error("Connection changed");
			const checked = refs.map((ref) => {
				const result = resources.find(
					(r) =>
						r.workspaceId === ref.workspaceId &&
						r.kind === ref.kind &&
						r.resourceId === ref.resourceId,
				);
				if (!result || (ref.kind === "terminal" && !ref.executionId))
					return {
						...ref,
						state: "unknown" as const,
						reason: "unsupported" as const,
					};
				return result;
			});
			if (job.reason === "manual")
				await this.recordConnect(id, () => this.current(job));
			if (!this.current(job)) {
				this.release(job);
				return;
			}
			this.emit(job, { status: "ready", descriptor, resources: checked });
			this.options.onReady?.(descriptor);
		} catch {
			if (this.current(job))
				this.emit(job, { status: "paused", reason: "unavailable" });
			this.release(job);
		}
	}
	private async connectExisting(
		job: RestoreJob,
		id: string,
	): Promise<ConnectionLease> {
		for (let attempt = 0; ; attempt++) {
			if (!this.current(job)) throw new Error("Restore cancelled");
			if (!this.options.manager.getLease(id))
				job.ownedGeneration = this.options.manager.getStatus(id).generation + 1;
			try {
				return await this.options.manager.connect(id, {
					mode: "restore-existing",
				});
			} catch (error) {
				if (
					!(error instanceof DirectConnectionError) ||
					!error.retryable ||
					attempt >= 3 ||
					!this.current(job)
				)
					throw error;
				await (
					this.options.wait ??
					((ms: number) =>
						new Promise<void>((resolve) => setTimeout(resolve, ms)))
				)(1000 * 2 ** attempt);
			}
		}
	}
	save(
		owner: number,
		input: {
			expectedRevision: number;
			navigationRevision: number;
			view: unknown;
		},
	) {
		this.acceptNavigation(owner, input.navigationRevision);
		const ownerEpoch = this.ownerEpoch;
		return this.enqueue(async () => {
			this.assertOwner(owner, ownerEpoch);
			if (input.navigationRevision !== this.navigationRevision)
				throw new Error("Workspace navigation changed");
			const previous = this.options.store.read();
			if (previous.revision !== input.expectedRevision)
				throw new Error("Workspace view revision changed");
			const view = validateWorkspaceView(input.view);
			for (const target of view.targets) {
				const old = previous.snapshot?.targets.find(
					(t) => t.connectionId === target.connectionId,
				);
				const profile = this.options.registry.get(target.connectionId);
				if (!profile) throw new Error("Workspace target is missing");
				if (profile.kind === "local")
					throw new Error("Automatic workspace views support SSH targets only");
				const lease = this.options.manager.getLease(target.connectionId);
				const preservePreviousIdentity =
					!!old &&
					old.workspaces.length > 0 &&
					!sameIdentity(
						old,
						profile,
						this.options.registry.getTargetRevision(target.connectionId),
					);
				if (!lease || preservePreviousIdentity) {
					if (!old) throw new Error("An authenticated connection is required");
					const existing = new Set(refsFor(old).map(refKey));
					if (refsFor(target).some((ref) => !existing.has(refKey(ref))))
						throw new Error("An authenticated resource reference is required");
					Object.assign(target, {
						targetRevision: old.targetRevision,
						backendId: old.backendId,
						namespaceId: old.namespaceId,
						serviceUid: old.serviceUid,
						autoConnect: old.autoConnect,
					});
				} else {
					if (!profile.backendId || !profile.namespaceId || !profile.serviceUid)
						throw new Error("The authenticated identity is missing");
					Object.assign(target, {
						targetRevision: this.options.registry.getTargetRevision(
							target.connectionId,
						)!,
						backendId: profile.backendId,
						namespaceId: profile.namespaceId,
						serviceUid: profile.serviceUid,
						autoConnect:
							old &&
							sameIdentity(
								old,
								profile,
								this.options.registry.getTargetRevision(target.connectionId),
							)
								? old.autoConnect
								: this.explicitConnections.has(target.connectionId),
					});
					const existing = new Set(
						old && sameIdentity(old, profile, target.targetRevision)
							? refsFor(old).map(refKey)
							: [],
					);
					const added = refsFor(target).filter(
						(ref) => !existing.has(refKey(ref)),
					);
					if (added.length) {
						const checked = (await this.options.controller.invoke({
							connectionId: target.connectionId,
							generation: lease.generation,
							path: "workspace.restoreResources",
							type: "query",
							input: { refs: added },
						})) as RestoreResourceCheck[];
						for (const ref of added) {
							const result = checked.find(
								(r) =>
									r.workspaceId === ref.workspaceId &&
									r.kind === ref.kind &&
									r.resourceId === ref.resourceId,
							);
							if (
								result?.state !== "live" ||
								(ref.executionId && ref.executionId !== result.executionId)
							)
								throw new Error("An authenticated live resource is required");
							if (ref.kind === "terminal") {
								if (!result.executionId)
									throw new Error("The terminal execution cannot be confirmed");
								const pane = target.workspaces
									.find((w) => w.workspaceId === ref.workspaceId)
									?.panes.find(
										(p) =>
											p.resourceId === ref.resourceId && p.kind === ref.kind,
									);
								if (pane) pane.executionId = result.executionId;
							}
						}
						if (
							this.options.manager.getLease(target.connectionId)?.generation !==
							lease.generation
						)
							throw new Error("Workspace connection changed");
					}
				}
			}
			this.assertOwner(owner, ownerEpoch);
			if (input.navigationRevision !== this.navigationRevision)
				throw new Error("Workspace navigation changed");
			return this.options.store.save({
				owner: String(owner),
				expectedRevision: input.expectedRevision,
				view,
			});
		});
	}
	private update(
		change: (view: WorkspaceViewInput) => void,
		allowed: () => boolean = () => true,
	): Promise<void> {
		const owner = this.owner;
		const ownerEpoch = this.ownerEpoch;
		if (owner === null) return Promise.resolve();
		return this.enqueue(() => {
			this.assertOwner(owner, ownerEpoch);
			if (!allowed()) return;
			const saved = this.options.store.read();
			const view = saved.snapshot
				? (({ schemaVersion: _, revision: __, updatedAt: ___, ...rest }) =>
						rest)(saved.snapshot)
				: emptyWorkspaceView(this.options.window());
			change(view);
			this.options.store.save({
				owner: String(owner),
				expectedRevision: saved.revision,
				view,
			});
		});
	}
	recordDisconnect(id: string): Promise<void> {
		this.invalidate();
		this.explicitConnections.delete(id);
		return this.update((v) => {
			const t = v.targets.find((t) => t.connectionId === id);
			if (t) t.autoConnect = false;
		});
	}
	recordConnect(
		id: string,
		allowed: () => boolean = () => true,
	): Promise<void> {
		return this.update((v) => {
			const profile = this.options.registry.get(id);
			if (profile?.kind === "local") {
				v.activeConnectionId = null;
				return;
			}
			if (
				!profile ||
				!profile.backendId ||
				!profile.namespaceId ||
				!profile.serviceUid
			)
				return;
			this.explicitConnections.add(id);
			let target = v.targets.find((t) => t.connectionId === id);
			if (
				target &&
				target.workspaces.length &&
				!sameIdentity(
					target,
					profile,
					this.options.registry.getTargetRevision(id),
				)
			) {
				target.autoConnect = false;
				v.activeConnectionId = id;
				return;
			}
			if (
				!target ||
				!sameIdentity(
					target,
					profile,
					this.options.registry.getTargetRevision(id),
				)
			) {
				v.targets = v.targets.filter((t) => t.connectionId !== id);
				target = {
					connectionId: id,
					targetRevision: this.options.registry.getTargetRevision(id)!,
					backendId: profile.backendId,
					namespaceId: profile.namespaceId,
					serviceUid: profile.serviceUid,
					autoConnect: true,
					activeTabId: null,
					workspaces: [],
				};
				v.targets.push(target);
			}
			target.autoConnect = true;
			v.activeConnectionId = id;
		}, allowed);
	}
	remove(id: string): Promise<void> {
		this.invalidate();
		return this.update((v) => {
			v.targets = v.targets.filter((t) => t.connectionId !== id);
			if (v.activeConnectionId === id) v.activeConnectionId = null;
		});
	}
	updateWindow(window: WorkspaceViewInput["window"]): Promise<void> {
		return this.update((v) => {
			v.window = window;
		});
	}
	forget(owner: number, expectedRevision: number): Promise<void> {
		this.assertOwner(owner);
		const ownerEpoch = this.ownerEpoch;
		this.invalidate();
		return this.enqueue(() => {
			this.assertOwner(owner, ownerEpoch);
			this.options.store.forget({ owner: String(owner), expectedRevision });
		});
	}
}
