import { expect, test } from "bun:test";
import {
	type PromptAttachment,
	PromptAttachmentQueue,
	type ResolvedPromptContent,
} from "./attachments";

const part = (attachmentId: string) => ({
	type: "attachment" as const,
	attachmentId,
	name: `${attachmentId}.png`,
	mimeType: "image/png",
});
const attachment: PromptAttachment = {
	path: "/remote/upload.png",
	mimeType: "image/png",
	data: "YWJj",
};

test("cancelling a slow read aborts it and cannot block or overwrite a newer prompt", async () => {
	let release!: (value: PromptAttachment) => void;
	const slow = new Promise<PromptAttachment>((resolve) => {
		release = resolve;
	});
	let started!: () => void;
	const reading = new Promise<void>((resolve) => {
		started = resolve;
	});
	let delivered!: () => void;
	const ready = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	const rows: ResolvedPromptContent[][] = [];
	let oldSignal!: AbortSignal;
	const queue = new PromptAttachmentQueue({
		resolve: async (id, signal) => {
			if (id === "old") {
				oldSignal = signal;
				started();
				return slow;
			}
			return attachment;
		},
		deliver: (content) => {
			rows.push(content);
			delivered();
		},
		fail: () => {
			throw new Error("No failure expected");
		},
	});
	queue.enqueue([part("old")]);
	await reading;
	expect(queue.cancel()).toBe(true);
	expect(oldSignal.aborted).toBe(true);
	queue.enqueue([part("new")]);
	await ready;
	release(attachment);
	await slow;
	await Promise.resolve();
	expect(rows).toHaveLength(1);
	expect(rows[0]?.[0]).toMatchObject({
		attachmentId: "new",
		resolvedAttachment: attachment,
	});
	queue.cancel();
});

test("an unreadable second attachment rejects the entire prepared message", async () => {
	let failed!: (error: unknown) => void;
	const failure = new Promise<unknown>((resolve) => {
		failed = resolve;
	});
	let deliveries = 0;
	const queue = new PromptAttachmentQueue({
		resolve: async (id) => (id === "missing" ? null : attachment),
		deliver: () => {
			deliveries++;
		},
		fail: failed,
	});
	queue.enqueue([part("valid"), part("missing")]);
	expect(String(await failure)).toContain("Could not read attachment");
	expect(deliveries).toBe(0);
	queue.cancel();
});

test("the byte cap applies to the whole message before any SDK input is delivered", async () => {
	let failed!: (error: unknown) => void;
	const failure = new Promise<unknown>((resolve) => {
		failed = resolve;
	});
	let deliveries = 0;
	const queue = new PromptAttachmentQueue({
		resolve: async () => attachment,
		deliver: () => {
			deliveries++;
		},
		fail: failed,
		maxBytes: 5,
	});
	queue.enqueue([part("first"), part("second")]);
	expect(String(await failure)).toContain("byte limit");
	expect(deliveries).toBe(0);
	queue.cancel();
});
