import { isImageFile } from "shared/file-types";

export interface MarkdownImageResources {
	owner: string;
	rootPath: string;
	readFile(path: string, revision?: string): Promise<Uint8Array>;
}
export type ImageResult = {
	kind: "bytes" | "text";
	content: string | Uint8Array;
	exceededLimit?: boolean;
};
type Entry = {
	key: string;
	path: string;
	promise: Promise<Uint8Array>;
	resolve(value: Uint8Array): void;
	reject(error: Error): void;
	bytes?: Uint8Array;
};
export class MarkdownImageReader {
	private readonly entries = new Map<string, Entry>();
	private readonly queue: Entry[] = [];
	private readonly maxBytes: number;
	private readonly maxCacheBytes: number;
	private readonly maxEntries: number;
	private readonly concurrency: number;
	private cacheBytes = 0;
	private running = 0;
	private active = true;
	constructor(
		private readonly options: {
			read(path: string, maxBytes: number): Promise<ImageResult>;
			isCurrent?(): boolean;
			maxBytes?: number;
			maxCacheBytes?: number;
			maxEntries?: number;
			concurrency?: number;
		},
	) {
		this.maxBytes = options.maxBytes ?? 1024 * 1024;
		this.maxCacheBytes = options.maxCacheBytes ?? 8 * 1024 * 1024;
		this.maxEntries = options.maxEntries ?? 16;
		this.concurrency = options.concurrency ?? 4;
		if (
			!Number.isSafeInteger(this.maxBytes) ||
			this.maxBytes < 1 ||
			this.maxBytes > 1024 * 1024 ||
			!Number.isSafeInteger(this.maxCacheBytes) ||
			this.maxCacheBytes < this.maxBytes ||
			this.maxCacheBytes > 8 * 1024 * 1024 ||
			!Number.isSafeInteger(this.maxEntries) ||
			this.maxEntries < 1 ||
			this.maxEntries > 16 ||
			!Number.isSafeInteger(this.concurrency) ||
			this.concurrency < 1 ||
			this.concurrency > 4
		)
			throw new Error("Invalid markdown image limits");
	}
	private isCurrent() {
		return this.active && (this.options.isCurrent?.() ?? true);
	}
	private remove(entry: Entry) {
		if (this.entries.get(entry.key) !== entry) return;
		this.entries.delete(entry.key);
		this.cacheBytes -= entry.bytes?.byteLength ?? 0;
	}
	private evictCompleted(): boolean {
		const entry = [...this.entries.values()].find(
			(entry) => entry.bytes !== undefined,
		);
		if (!entry) return false;
		this.remove(entry);
		return true;
	}
	readFile = (path: string, revision = ""): Promise<Uint8Array> => {
		if (!this.isCurrent() || path.length > 4096 || !isImageFile(path))
			return Promise.reject(new Error("Image resource is unavailable"));
		const key = JSON.stringify([path, revision]);
		const cached = this.entries.get(key);
		if (cached) {
			this.entries.delete(key);
			this.entries.set(key, cached);
			return cached.promise;
		}
		if (this.entries.size >= this.maxEntries && !this.evictCompleted())
			return Promise.reject(new Error("Too many pending image reads"));
		let resolve!: Entry["resolve"], reject!: Entry["reject"];
		const promise = new Promise<Uint8Array>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		const entry = { key, path, promise, resolve, reject };
		this.entries.set(key, entry);
		this.queue.push(entry);
		this.pump();
		return promise;
	};
	private pump() {
		if (!this.isCurrent()) {
			this.dispose();
			return;
		}
		while (this.running < this.concurrency && this.queue.length) {
			const entry = this.queue.shift();
			if (!entry) break;
			this.running++;
			void this.fetch(entry).finally(() => {
				this.running--;
				this.pump();
			});
		}
	}
	private async fetch(entry: Entry) {
		try {
			if (!this.isCurrent()) throw new Error("Image owner changed");
			const result = await this.options.read(entry.path, this.maxBytes);
			if (!this.isCurrent()) throw new Error("Image owner changed");
			if (
				result.exceededLimit ||
				(typeof result.content === "string" &&
					result.kind === "bytes" &&
					result.content.length > Math.ceil(this.maxBytes / 3) * 4)
			)
				throw new Error("Image exceeds preview limit");
			const bytes =
				typeof result.content !== "string"
					? result.content
					: result.kind === "text"
						? new TextEncoder().encode(result.content)
						: Uint8Array.from(atob(result.content), (ch) => ch.charCodeAt(0));
			if (!bytes.byteLength || bytes.byteLength > this.maxBytes)
				throw new Error("Image exceeds preview limit");
			while (
				this.cacheBytes + bytes.byteLength > this.maxCacheBytes &&
				this.evictCompleted()
			) {}
			entry.bytes = bytes;
			this.cacheBytes += bytes.byteLength;
			entry.resolve(bytes);
		} catch (error) {
			this.remove(entry);
			entry.reject(error instanceof Error ? error : new Error(String(error)));
		}
	}
	dispose() {
		this.active = false;
		for (const entry of this.queue.splice(0))
			entry.reject(new Error("Image owner changed"));
		this.entries.clear();
		this.cacheBytes = 0;
	}
}
