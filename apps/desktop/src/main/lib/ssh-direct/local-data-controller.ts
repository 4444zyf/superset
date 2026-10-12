import type { DirectLocalNamespace } from "../../../shared/direct-workstation";

interface LocalSelection {
	listNamespaces(): DirectLocalNamespace[];
	getSelectionRevision(): number;
	selectNamespace(id: string): DirectLocalNamespace;
}

export class LocalDataController {
	private busy = false;
	constructor(
		private readonly options: {
			local: LocalSelection;
			hasPending(): boolean;
			disconnect(): void;
			pin(namespace: DirectLocalNamespace): void;
		},
	) {}

	assertAvailable(): void {
		if (this.busy) throw new Error("Another local data action is in progress");
	}

	private assertNoPending(): void {
		if (this.options.hasPending())
			throw new Error(
				"Reconcile pending operations before changing local data",
			);
	}

	capture(): { namespace: DirectLocalNamespace; revision: number } {
		const namespace = this.options.local
			.listNamespaces()
			.find((row) => row.selected);
		if (!namespace) throw new Error("The selected local namespace is missing");
		return { namespace, revision: this.options.local.getSelectionRevision() };
	}

	assertCurrent(selection: ReturnType<LocalDataController["capture"]>): void {
		const current = this.capture();
		if (
			current.revision !== selection.revision ||
			current.namespace.id !== selection.namespace.id
		)
			throw new Error(
				"Local namespace selection changed; choose the action again",
			);
	}

	selectNamespace(id: string): DirectLocalNamespace {
		this.assertAvailable();
		this.assertNoPending();
		if (!this.options.local.listNamespaces().some((row) => row.id === id))
			throw new Error("The local namespace is missing");
		this.options.disconnect();
		const namespace = this.options.local.selectNamespace(id);
		this.options.pin(namespace);
		return namespace;
	}

	async runSelected<T>(
		prepare: (namespace: DirectLocalNamespace) => Promise<boolean>,
		operation: (namespace: DirectLocalNamespace) => Promise<T>,
		options: { disconnect?: boolean } = {},
	): Promise<T | { status: "cancelled" }> {
		this.assertAvailable();
		this.assertNoPending();
		const selection = this.capture();
		if (!(await prepare(selection.namespace))) return { status: "cancelled" };
		this.assertCurrent(selection);
		this.assertAvailable();
		this.assertNoPending();
		this.busy = true;
		try {
			if (options.disconnect !== false) this.options.disconnect();
			return await operation(selection.namespace);
		} finally {
			this.busy = false;
		}
	}
}
