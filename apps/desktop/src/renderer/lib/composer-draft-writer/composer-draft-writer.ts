export class ComposerDraftWriter<T> {
	private readonly pending = new Set<string>();
	private cancelTimer: (() => void) | null = null;
	private inFlight: Promise<void> | null = null;
	constructor(
		private readonly cache: Map<string, T>,
		private readonly persist: (
			key: string,
			value: T,
		) => boolean | Promise<boolean>,
		private readonly schedule: (callback: () => void) => () => void = (
			callback,
		) => {
			const timer = setTimeout(callback, 300);
			return () => clearTimeout(timer);
		},
	) {}
	change(key: string, value: T) {
		this.cache.set(key, value);
		this.pending.add(key);
		this.cancelTimer?.();
		this.cancelTimer = this.schedule(() => {
			this.cancelTimer = null;
			void this.flush();
		});
	}
	pause() {
		this.cancelTimer?.();
		this.cancelTimer = null;
	}

	cancel() {
		this.pause();
		this.pending.clear();
	}
	flush(): void | Promise<void> {
		this.cancelTimer?.();
		this.cancelTimer = null;
		if (this.inFlight) return this.inFlight;
		while (this.pending.size) {
			const key = this.pending.values().next().value!;
			this.pending.delete(key);
			const value = this.cache.get(key);
			if (value === undefined) continue;
			const finish = (saved: boolean) => {
				if (saved && this.cache.get(key) === value) this.cache.delete(key);
				else this.pending.add(key);
			};
			let result: boolean | Promise<boolean>;
			try {
				result = this.persist(key, value);
			} catch {
				result = false;
			}
			if (typeof result === "boolean") {
				finish(result);
				if (!result) return;
				continue;
			}
			let saved = false;
			this.inFlight = Promise.resolve(result)
				.then(
					(value) => {
						saved = value;
						finish(value);
					},
					() => finish(false),
				)
				.finally(() => {
					this.inFlight = null;
					if (saved && this.pending.size) return this.flush();
				});
			return this.inFlight;
		}
	}
}
