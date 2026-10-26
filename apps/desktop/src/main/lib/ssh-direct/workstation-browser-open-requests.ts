import { randomUUID } from "node:crypto";
import type { DirectDescriptor } from "../../../shared/direct-workstation";

export interface WorkstationBrowserOpenInput {
	descriptor: DirectDescriptor;
	workspaceId: string;
	projectId: string | null;
	workspaceName: string;
	url: string;
	target: "current-tab" | "new-tab";
	show: boolean;
}
export interface WorkstationBrowserOpenResult {
	paneId: string;
	url: string;
	title: string;
}
interface Owner {
	ownerId: number;
	ownerEpoch: number;
}
interface Lease extends Owner {
	scopeId: string;
	subscriptionId: string;
}
export type WorkstationBrowserOpenEvent =
	| {
			type: "open";
			id: string;
			scopeId: string;
			subscriptionId: string;
			input: WorkstationBrowserOpenInput;
	  }
	| { type: "cancel"; id: string; scopeId: string; subscriptionId: string };
type Reply = { id: string; scopeId: string; subscriptionId: string } & (
	| { ok: true; result: WorkstationBrowserOpenResult }
	| { ok: false; error: string }
);
interface Pending {
	id: string;
	lease: Lease;
	isTargetCurrent(): boolean;
	started: boolean;
	resolve?(value: WorkstationBrowserOpenResult): void;
	reject?(error: Error): void;
	cancel?(): void;
}
export class WorkstationBrowserOpenError extends Error {
	constructor(
		readonly kind: "unavailable" | "busy" | "timeout",
		message: string,
	) {
		super(message);
		this.name = "WorkstationBrowserOpenError";
	}
}
function schedule(milliseconds: number, callback: () => void) {
	const timer = setTimeout(callback, milliseconds);
	timer.unref?.();
	return () => clearTimeout(timer);
}

export class WorkstationBrowserOpenRequests {
	private scopeId = randomUUID();
	private candidate: Lease | null = null;
	private lease: Lease | null = null;
	private pending: Pending | null = null;
	private disposed = false;
	constructor(
		private readonly dependencies: {
			getOwner(): Owner | null;
			dispatch(ownerId: number, event: WorkstationBrowserOpenEvent): void;
			changed(): void;
			schedule?: typeof schedule;
		},
	) {}
	private notify() {
		try {
			this.dependencies.changed();
		} catch {}
	}
	private currentLease(): Lease | null {
		const owner = this.dependencies.getOwner(),
			lease = this.lease;
		return !this.disposed &&
			lease &&
			owner?.ownerId === lease.ownerId &&
			owner.ownerEpoch === lease.ownerEpoch &&
			lease.scopeId === this.scopeId
			? lease
			: null;
	}
	availability() {
		const ready = this.currentLease() !== null;
		return {
			scopeId: this.scopeId,
			ready,
			accepting: ready && this.pending === null,
		};
	}
	prepare(ownerId: number, subscriptionId: string): { scopeId: string } {
		const owner = this.dependencies.getOwner();
		if (this.disposed || !owner || owner.ownerId !== ownerId)
			throw new WorkstationBrowserOpenError(
				"unavailable",
				"Browser renderer is unavailable",
			);
		this.invalidate();
		this.candidate = { ...owner, subscriptionId, scopeId: this.scopeId };
		return { scopeId: this.scopeId };
	}
	confirmReady(
		ownerId: number,
		scope: { scopeId: string; subscriptionId: string },
	): boolean {
		const candidate = this.candidate,
			owner = this.dependencies.getOwner();
		if (
			this.disposed ||
			!candidate ||
			candidate.ownerId !== ownerId ||
			owner?.ownerId !== ownerId ||
			owner.ownerEpoch !== candidate.ownerEpoch ||
			candidate.scopeId !== scope.scopeId ||
			scope.scopeId !== this.scopeId ||
			candidate.subscriptionId !== scope.subscriptionId
		)
			return false;
		this.lease = candidate;
		this.notify();
		return true;
	}
	end(ownerId: number, subscriptionId: string): void {
		if (
			this.candidate?.ownerId === ownerId &&
			this.candidate.subscriptionId === subscriptionId
		)
			this.invalidate();
	}
	private cancelEvent(pending: Pending): void {
		const owner = this.dependencies.getOwner();
		if (
			!pending.started ||
			owner?.ownerId !== pending.lease.ownerId ||
			owner.ownerEpoch !== pending.lease.ownerEpoch
		)
			return;
		try {
			this.dependencies.dispatch(pending.lease.ownerId, {
				type: "cancel",
				id: pending.id,
				scopeId: pending.lease.scopeId,
				subscriptionId: pending.lease.subscriptionId,
			});
		} catch {}
	}
	private clear(
		pending: Pending,
		error?: Error,
		cancel = false,
		result?: WorkstationBrowserOpenResult,
	): void {
		if (this.pending !== pending) return;
		this.pending = null;
		pending.cancel?.();
		if (cancel) this.cancelEvent(pending);
		if (error) pending.reject?.(error);
		else if (result) pending.resolve?.(result);
		this.notify();
	}
	invalidate(
		error: Error = new WorkstationBrowserOpenError(
			"unavailable",
			"Browser open scope is no longer current",
		),
	): void {
		this.scopeId = randomUUID();
		this.candidate = null;
		this.lease = null;
		const pending = this.pending;
		if (pending) this.clear(pending, error, true);
		else this.notify();
	}
	pin(
		input: WorkstationBrowserOpenInput,
		scopeId: string,
		isTargetCurrent: () => boolean,
	): (() => Promise<WorkstationBrowserOpenResult>) & { release?(): void } {
		if (scopeId !== this.scopeId)
			throw new WorkstationBrowserOpenError(
				"unavailable",
				"Browser open scope changed",
			);
		const lease = this.currentLease();
		if (!lease || !isTargetCurrent())
			throw new WorkstationBrowserOpenError(
				"unavailable",
				"Browser open renderer is unavailable",
			);
		if (this.pending)
			throw new WorkstationBrowserOpenError(
				"busy",
				"A browser open is already pending",
			);
		const captured = structuredClone(input),
			pending: Pending = {
				id: randomUUID(),
				lease,
				started: false,
				isTargetCurrent,
			};
		this.pending = pending;
		this.notify();
		const current = () =>
			this.pending === pending &&
			this.currentLease() === lease &&
			scopeId === this.scopeId &&
			isTargetCurrent();
		let attempted = false;
		const execute = () => {
			if (attempted)
				return Promise.reject(
					new WorkstationBrowserOpenError(
						"unavailable",
						"The pinned browser open was already executed",
					),
				);
			attempted = true;
			if (!current()) {
				const error = new WorkstationBrowserOpenError(
					"unavailable",
					"The pinned browser open is unavailable",
				);
				this.clear(pending, error);
				return Promise.reject(error);
			}
			pending.started = true;
			return new Promise<WorkstationBrowserOpenResult>((resolve, reject) => {
				pending.resolve = resolve;
				pending.reject = reject;
				pending.cancel = (this.dependencies.schedule ?? schedule)(
					15_000,
					() => {
						if (this.pending === pending)
							this.invalidate(
								new WorkstationBrowserOpenError(
									"timeout",
									"Browser open acknowledgement timed out",
								),
							);
					},
				);
				try {
					this.dependencies.dispatch(lease.ownerId, {
						type: "open",
						id: pending.id,
						scopeId,
						subscriptionId: lease.subscriptionId,
						input: captured,
					});
				} catch {
					this.invalidate(
						new WorkstationBrowserOpenError(
							"unavailable",
							"Browser open renderer transport failed",
						),
					);
				}
			});
		};
		execute.release = () =>
			this.clear(
				pending,
				new WorkstationBrowserOpenError(
					"unavailable",
					"The pinned browser open was released",
				),
				true,
			);
		return execute;
	}
	complete(ownerId: number, reply: Reply): boolean {
		const pending = this.pending;
		if (
			!pending ||
			!pending.started ||
			pending.lease !== this.currentLease() ||
			!pending.isTargetCurrent() ||
			pending.lease.ownerId !== ownerId ||
			pending.id !== reply.id ||
			pending.lease.scopeId !== reply.scopeId ||
			pending.lease.subscriptionId !== reply.subscriptionId
		)
			return false;
		if (reply.ok) this.clear(pending, undefined, false, reply.result);
		else
			this.clear(
				pending,
				new WorkstationBrowserOpenError("unavailable", reply.error),
			);
		return true;
	}
	refresh(): void {
		const pending = this.pending;
		if (
			pending &&
			(pending.lease !== this.currentLease() || !pending.isTargetCurrent())
		)
			this.clear(
				pending,
				new WorkstationBrowserOpenError(
					"unavailable",
					"Browser open target changed",
				),
				true,
			);
		else this.notify();
	}
	dispose(): void {
		this.disposed = true;
		this.invalidate();
	}
}
