import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import type {
	WorkstationPreferencePatch,
	WorkstationPreferenceSnapshot,
} from "../../../../../shared/workstation-preferences";

export interface PreferenceClientState {
	snapshot: WorkstationPreferenceSnapshot | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
}

export class PreferenceClient {
	private state: PreferenceClientState = {
		snapshot: null,
		loading: false,
		saving: false,
		error: null,
	};
	private readonly listeners = new Set<() => void>();
	private alive = true;
	private readPromise: Promise<void> | null = null;
	constructor(
		private readonly api: Pick<
			DirectWorkstationApi,
			"getPreferences" | "updatePreferences"
		>,
	) {}
	getSnapshot = (): PreferenceClientState => this.state;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(patch: Partial<PreferenceClientState>): void {
		if (!this.alive) return;
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
	load(): Promise<void> {
		if (this.readPromise) return this.readPromise;
		this.publish({ loading: true });
		this.readPromise = (async () => {
			try {
				if (!this.api.getPreferences)
					throw new Error("Workstation preferences are unavailable");
				const snapshot = await this.api.getPreferences();
				if (!this.alive) return;
				if (
					!this.state.snapshot ||
					snapshot.revision >= this.state.snapshot.revision
				)
					this.publish({ snapshot, error: null });
			} catch (error) {
				this.publish({
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		})();
		this.readPromise = this.readPromise.finally(() => {
			this.readPromise = null;
			this.publish({ loading: false });
		});
		return this.readPromise;
	}
	async update(
		patch: WorkstationPreferencePatch,
	): Promise<WorkstationPreferenceSnapshot> {
		if (!this.alive) throw new Error("Preference client is disposed");
		if (this.state.saving)
			throw new Error("A settings update is already in progress");
		if (
			!this.api.updatePreferences ||
			!this.state.snapshot ||
			this.state.snapshot.invalid
		)
			throw new Error("Workstation preferences are unavailable");
		const expectedRevision = this.state.snapshot.revision;
		this.publish({ saving: true });
		try {
			const snapshot = await this.api.updatePreferences({
				expectedRevision,
				patch,
			});
			if (
				this.alive &&
				(!this.state.snapshot ||
					snapshot.revision >= this.state.snapshot.revision)
			)
				this.publish({ snapshot, error: null });
			return snapshot;
		} catch (error) {
			await this.readPromise?.catch(() => {});
			await this.load().catch(() => {});
			this.publish({
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			this.publish({ saving: false });
		}
	}
	dispose(): void {
		this.alive = false;
		this.listeners.clear();
	}
}
