import { z } from "zod";
export const MAX_CHAT_DRAFTS = 32;
export const MAX_CHAT_DRAFT_BYTES = 1024 * 1024;
export const MAX_CHAT_DRAFT_STORAGE_BYTES = 8 * 1024 * 1024;
const identifier = z
	.string()
	.min(1)
	.max(256)
	.refine((value) => !value.includes("\0"));
export const chatDraftIdentitySchema = z
	.object({
		connectionId: identifier,
		backendId: identifier,
		namespaceId: identifier,
		workspaceId: identifier,
		sessionId: identifier,
	})
	.strict();
export const chatDraftValueSchema = z
	.object({
		text: z
			.string()
			.max(MAX_CHAT_DRAFT_BYTES)
			.refine(
				(value) =>
					new TextEncoder().encode(value).byteLength <= MAX_CHAT_DRAFT_BYTES,
			),
		attachments: z
			.array(
				z
					.object({
						attachmentId: identifier,
						originalFilename: z.string().max(4096).optional(),
						mediaType: z.string().min(1).max(255),
						sizeBytes: z
							.number()
							.int()
							.nonnegative()
							.max(25 * 1024 * 1024),
					})
					.strict(),
			)
			.max(16),
	})
	.strict()
	.refine(
		(value) =>
			value.attachments.reduce((sum, item) => sum + item.sizeBytes, 0) <=
			25 * 1024 * 1024,
	);
export type ChatDraftIdentity = z.infer<typeof chatDraftIdentitySchema>;
export type ChatDraftValue = z.infer<typeof chatDraftValueSchema>;
export const chatDraftEntrySchema = z
	.object({ identity: chatDraftIdentitySchema, value: chatDraftValueSchema })
	.strict();
export type ChatDraftEntry = z.infer<typeof chatDraftEntrySchema>;
export const chatDraftKey = (identity: ChatDraftIdentity) =>
	JSON.stringify([
		identity.connectionId,
		identity.backendId,
		identity.namespaceId,
		identity.workspaceId,
		identity.sessionId,
	]);
export const chatDraftEntriesSchema = z
	.array(chatDraftEntrySchema)
	.max(MAX_CHAT_DRAFTS)
	.refine(
		(entries) =>
			new Set(entries.map((entry) => chatDraftKey(entry.identity))).size ===
			entries.length,
	)
	.refine(
		(entries) =>
			new TextEncoder().encode(JSON.stringify(entries)).byteLength <=
			MAX_CHAT_DRAFT_STORAGE_BYTES,
	);
export interface WorkstationChatDraftSnapshot {
	revision: number;
	invalid: boolean;
	entries: ChatDraftEntry[];
}
export interface WorkstationChatDraftUpdate {
	expectedRevision: number;
	entries: ChatDraftEntry[];
}

export type ChatDraftTarget = Pick<ChatDraftIdentity, "connectionId"> &
	Partial<Omit<ChatDraftIdentity, "connectionId">>;
export function hasChatDraftsForTarget(
	entries: ChatDraftEntry[],
	target: ChatDraftTarget,
): boolean {
	const fields = [
		"connectionId",
		"backendId",
		"namespaceId",
		"workspaceId",
		"sessionId",
	] as const;
	return entries.some(
		(entry) =>
			(entry.value.text.length > 0 || entry.value.attachments.length > 0) &&
			fields.every(
				(field) =>
					target[field] === undefined ||
					entry.identity[field] === target[field],
			),
	);
}
