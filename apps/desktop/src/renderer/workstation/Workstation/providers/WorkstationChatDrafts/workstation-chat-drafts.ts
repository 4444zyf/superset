import { ComposerDraftWriter } from "renderer/lib/composer-draft-writer/composer-draft-writer";
import type { DirectWorkstationApi } from "../../../../../shared/direct-workstation";
import {
	type ChatDraftEntry,
	type ChatDraftIdentity,
	type ChatDraftValue,
	chatDraftEntriesSchema,
	chatDraftEntrySchema,
	chatDraftKey,
	MAX_CHAT_DRAFT_STORAGE_BYTES,
	MAX_CHAT_DRAFTS,
} from "../../../../../shared/workstation-chat-drafts";

const EMPTY: ChatDraftValue = { text: "", attachments: [] };
export class WorkstationChatDraftStore {
	private entries = new Map<string, ChatDraftEntry>();
	private sizes = new Map<string, number>();
	private bytes = 2;
	private readonly overrides = new Set<string>();
	private readonly pending = new Map<string, number>();
	private readonly listeners = new Set<() => void>();
	private version = 0;
	private sequence = 0;
	private savedSequence = 0;
	private revision = 0;
	private ready: boolean;
	private loading: Promise<void> | null = null;
	private readonly writer: ComposerDraftWriter<number>;
	error: string | null = null;
	constructor(
		private readonly api: Pick<
			DirectWorkstationApi,
			"getChatDrafts" | "saveChatDrafts"
		>,
		schedule?: (callback: () => void) => () => void,
	) {
		this.ready = !api.getChatDrafts;
		this.writer = new ComposerDraftWriter(
			this.pending,
			async () => {
				try {
					await this.start();
					if (this.sequence === this.savedSequence) return true;
					const sequence = this.sequence;
					const entries = [...this.entries.values()];
					if (this.api.saveChatDrafts) {
						const result = await this.api.saveChatDrafts({
							expectedRevision: this.revision,
							entries,
						});
						if (result.invalid || result.revision !== this.revision + 1)
							throw new Error("Chat draft save was not confirmed");
						this.revision = result.revision;
					}
					this.savedSequence = sequence;
					this.error = null;
					this.notify();
					return true;
				} catch (error) {
					this.error = error instanceof Error ? error.message : String(error);
					this.notify();
					return false;
				}
			},
			schedule,
		);
	}
	private notify() {
		this.version++;
		for (const listener of this.listeners) listener();
	}
	getVersion = () => this.version;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	get(identity: ChatDraftIdentity | null): ChatDraftValue {
		return identity
			? (this.entries.get(chatDraftKey(identity))?.value ?? EMPTY)
			: EMPTY;
	}
	start(): Promise<void> {
		if (this.ready) return Promise.resolve();
		if (this.loading) return this.loading;
		this.loading = (async () => {
			try {
				const snapshot = await this.api.getChatDrafts!();
				if (snapshot.invalid)
					throw new Error(
						"Chat draft storage is invalid; retained drafts cannot be overwritten",
					);
				const entries = chatDraftEntriesSchema.parse(snapshot.entries);
				const merged = new Map(
					entries
						.filter(
							(entry) => !this.overrides.has(chatDraftKey(entry.identity)),
						)
						.map((entry) => [chatDraftKey(entry.identity), entry]),
				);
				for (const [key, entry] of this.entries) merged.set(key, entry);
				chatDraftEntriesSchema.parse([...merged.values()]);
				this.entries = merged;
				this.sizes = new Map(
					[...merged].map(([key, entry]) => [key, this.size(entry)]),
				);
				this.bytes =
					2 + [...this.sizes.values()].reduce((sum, size) => sum + size + 1, 0);
				this.revision = snapshot.revision;
				this.ready = true;
				this.overrides.clear();
				this.error = null;
				this.notify();
			} catch (error) {
				this.error = error instanceof Error ? error.message : String(error);
				this.notify();
				throw error;
			} finally {
				this.loading = null;
			}
		})();
		return this.loading;
	}
	private size(entry: ChatDraftEntry) {
		return new TextEncoder().encode(JSON.stringify(entry)).byteLength;
	}
	change(identity: ChatDraftIdentity, value: ChatDraftValue) {
		const entry = chatDraftEntrySchema.parse({ identity, value });
		const key = chatDraftKey(identity);
		const empty = !value.text && value.attachments.length === 0;
		const size = empty ? 0 : this.size(entry);
		const oldSize = this.sizes.get(key) ?? 0;
		if (
			!this.ready &&
			!this.overrides.has(key) &&
			this.overrides.size >= MAX_CHAT_DRAFTS
		)
			throw new Error("Too many unsaved chat drafts");
		if (
			!empty &&
			!this.entries.has(key) &&
			this.entries.size >= MAX_CHAT_DRAFTS
		)
			throw new Error("Too many unsaved chat drafts");
		if (this.bytes - oldSize + size > MAX_CHAT_DRAFT_STORAGE_BYTES - 64)
			throw new Error("Chat drafts exceed their storage limit");
		if (!this.ready) this.overrides.add(key);
		this.bytes += size - oldSize;
		if (empty) {
			this.entries.delete(key);
			this.sizes.delete(key);
		} else {
			this.entries.set(key, entry);
			this.sizes.set(key, size);
		}
		this.sequence++;
		this.writer.change("snapshot", this.sequence);
		this.notify();
	}
	async flush() {
		await this.start();
		await this.writer.flush();
		if (this.error || this.sequence !== this.savedSequence)
			throw new Error(this.error ?? "Chat draft save was not confirmed");
	}
	stop() {
		this.writer.cancel();
	}
}
