import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";

export const MAX_BROWSER_ICON_BYTES = 256 * 1024;
const MAX_PENDING = 16;
const MAX_CACHE = 64;
const CACHE_TTL_MS = 5 * 60_000;
const IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/svg+xml",
	"image/x-icon",
	"image/vnd.microsoft.icon",
]);

export interface BrowserIconLease {
	key: string;
	url: string;
	current(): boolean;
	resolveRedirect(url: string): Promise<string | null>;
	fetch(
		url: string,
		options: {
			signal: AbortSignal;
			redirect: "manual";
			credentials: "include";
		},
	): Promise<Response>;
}

export class WorkstationBrowserIcons {
	private readonly cache = new Map<
		string,
		{ dataUrl: string; expires: number }
	>();
	private readonly pending = new Map<string, Promise<string | null>>();
	constructor(
		private readonly dependencies: {
			resolve(
				owner: number,
				pane: WorkstationBrowserPane,
				url: string,
			): Promise<BrowserIconLease | null>;
			now?: () => number;
		},
	) {}
	async get(
		owner: number,
		pane: WorkstationBrowserPane,
		url: string,
	): Promise<{ dataUrl: string } | null> {
		let lease: BrowserIconLease | null;
		try {
			lease = await this.dependencies.resolve(owner, pane, url);
		} catch {
			return null;
		}
		if (!lease?.current()) return null;
		const cached = this.cache.get(lease.key);
		if (cached && cached.expires > (this.dependencies.now ?? Date.now)()) {
			this.cache.delete(lease.key);
			this.cache.set(lease.key, cached);
			return { dataUrl: cached.dataUrl };
		}
		this.cache.delete(lease.key);
		let request = this.pending.get(lease.key);
		if (!request) {
			if (this.pending.size >= MAX_PENDING) return null;
			request = this.load(lease);
			this.pending.set(lease.key, request);
		}
		try {
			const dataUrl = await request;
			if (!dataUrl || !lease.current()) return null;
			this.cache.delete(lease.key);
			this.cache.set(lease.key, {
				dataUrl,
				expires: (this.dependencies.now ?? Date.now)() + CACHE_TTL_MS,
			});
			while (this.cache.size > MAX_CACHE)
				this.cache.delete(this.cache.keys().next().value!);
			return { dataUrl };
		} finally {
			if (this.pending.get(lease.key) === request)
				this.pending.delete(lease.key);
		}
	}
	private async load(lease: BrowserIconLease): Promise<string | null> {
		let url = lease.url;
		const signal = AbortSignal.timeout(10_000);
		try {
			for (let hop = 0; hop < 4; hop++) {
				if (
					!lease.current() ||
					!["http:", "https:"].includes(new URL(url).protocol)
				)
					return null;
				const response = await lease.fetch(url, {
					signal,
					redirect: "manual",
					credentials: "include",
				});
				if (!lease.current()) {
					await response.body?.cancel();
					return null;
				}
				if ([301, 302, 303, 307, 308].includes(response.status)) {
					await response.body?.cancel();
					const location = response.headers.get("location");
					if (!location || !lease.current()) return null;
					const resolved = await lease.resolveRedirect(
						new URL(location, url).href,
					);
					if (!resolved) return null;
					url = resolved;
					continue;
				}
				const type = response.headers
					.get("content-type")
					?.split(";")[0]
					?.trim()
					.toLowerCase();
				if (
					!response.ok ||
					!response.body ||
					!type ||
					!IMAGE_TYPES.has(type) ||
					Number(response.headers.get("content-length")) >
						MAX_BROWSER_ICON_BYTES
				) {
					await response.body?.cancel();
					return null;
				}
				const reader = response.body.getReader(),
					chunks: Uint8Array[] = [];
				let size = 0;
				try {
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) break;
						size += chunk.value.byteLength;
						if (!lease.current() || size > MAX_BROWSER_ICON_BYTES) {
							await reader.cancel();
							return null;
						}
						chunks.push(chunk.value);
					}
				} finally {
					reader.releaseLock();
				}
				if (!lease.current() || !size) return null;
				return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
			}
		} catch {
			return null;
		}
		return null;
	}
}
