import { createContext } from "react";
export interface WorkstationEditorGuard {
	id: string;
	label(): string;
	isDirty(): boolean;
	isPending(): boolean;
	getError(): string | null;
	save(): Promise<boolean>;
}
export class WorkstationEditorGuards {
	private readonly entries = new Map<string, WorkstationEditorGuard>();
	private readonly listeners = new Set<() => void>();
	private version = 0;
	getVersion = () => this.version;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	changed = () => {
		this.version++;
		for (const listener of this.listeners) listener();
	};
	register(guard: WorkstationEditorGuard) {
		this.entries.set(guard.id, guard);
		this.changed();
		return () => {
			if (this.entries.get(guard.id) === guard) {
				this.entries.delete(guard.id);
				this.changed();
			}
		};
	}
	getUnsaved() {
		return [...this.entries.values()].filter(
			(guard) => guard.isDirty() || guard.isPending(),
		);
	}
}
export const WorkstationEditorGuardsContext =
	createContext<WorkstationEditorGuards | null>(null);
