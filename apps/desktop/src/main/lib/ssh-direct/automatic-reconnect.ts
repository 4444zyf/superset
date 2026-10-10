import type {
	DirectConnectionEvent,
	DirectDescriptor,
} from "../../../shared/direct-workstation";

interface Clock {
	set(run: () => Promise<void>, delay: number): unknown;
	clear(timer: unknown): void;
}

interface Options {
	getStatus(id: string): { state: string; generation: number };
	connect(id: string): Promise<DirectDescriptor>;
	notify(event: DirectConnectionEvent): void;
	clock?: Clock;
}

interface Entry {
	descriptor: DirectDescriptor;
	attempt: number;
	timer?: unknown;
}

const systemClock: Clock = {
	set: (run, delay) => setTimeout(() => void run(), delay),
	clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
const backoff = [1000, 2000, 4000];

export class AutomaticReconnect {
	private readonly entries = new Map<string, Entry>();
	private readonly clock: Clock;
	constructor(private readonly options: Options) {
		this.clock = options.clock ?? systemClock;
	}
	arm(descriptor: DirectDescriptor, kind: "ssh" | "local"): void {
		this.disarm(descriptor.connectionId);
		if (kind === "local") return;
		const entry: Entry = { descriptor, attempt: 0 };
		this.entries.set(descriptor.connectionId, entry);
		this.poll(entry);
	}
	disarm(id: string): void {
		const entry = this.entries.get(id);
		if (entry?.timer !== undefined) this.clock.clear(entry.timer);
		this.entries.delete(id);
	}
	dispose(): void {
		for (const id of this.entries.keys()) this.disarm(id);
	}
	private current(entry: Entry): boolean {
		return this.entries.get(entry.descriptor.connectionId) === entry;
	}
	private poll(entry: Entry): void {
		entry.timer = this.clock.set(async () => {
			if (!this.current(entry)) return;
			const status = this.options.getStatus(entry.descriptor.connectionId);
			if (
				status.state === "ready" &&
				status.generation === entry.descriptor.generation
			) {
				this.poll(entry);
			} else if (status.state === "disconnected") {
				this.scheduleAttempt(entry);
			} else {
				this.disarm(entry.descriptor.connectionId);
			}
		}, 1000);
	}
	private scheduleAttempt(entry: Entry): void {
		const delay = backoff[entry.attempt];
		if (delay === undefined) return;
		entry.attempt += 1;
		this.options.notify({
			kind: "reconnecting",
			connectionId: entry.descriptor.connectionId,
			previousGeneration: entry.descriptor.generation,
			attempt: entry.attempt,
		});
		entry.timer = this.clock.set(() => this.attempt(entry), delay);
	}
	private async attempt(entry: Entry): Promise<void> {
		try {
			if (!this.current(entry)) return;
			const descriptor = await this.options.connect(
				entry.descriptor.connectionId,
			);
			if (!this.current(entry)) return;
			const status = this.options.getStatus(descriptor.connectionId);
			if (
				descriptor.connectionId !== entry.descriptor.connectionId ||
				descriptor.backendId !== entry.descriptor.backendId ||
				descriptor.namespaceId !== entry.descriptor.namespaceId ||
				status.state !== "ready" ||
				status.generation !== descriptor.generation
			)
				throw new Error(
					"The reconnected backend identity or generation changed",
				);
			this.options.notify({
				kind: "connected",
				connectionId: descriptor.connectionId,
				previousGeneration: entry.descriptor.generation,
				descriptor,
			});
			entry.descriptor = descriptor;
			entry.attempt = 0;
			this.poll(entry);
		} catch (error) {
			if (!this.current(entry)) return;
			if (
				(error as { retryable?: boolean } | null)?.retryable === true &&
				entry.attempt < backoff.length
			) {
				this.scheduleAttempt(entry);
			} else {
				this.options.notify({
					kind: "blocked",
					connectionId: entry.descriptor.connectionId,
					previousGeneration: entry.descriptor.generation,
					error: error instanceof Error ? error.message : "Connection failed",
				});
				this.disarm(entry.descriptor.connectionId);
			}
		}
	}
}
