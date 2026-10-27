import { expect, test } from "bun:test";
import {
	browserOpenIdentitySchema,
	browserOpenScopeSchema,
	browserOpenSubscriptionSchema,
	browserOpenReplySchema,
	browserOpenSaveSchema,
} from "./workstation-browser-open";
const identity = () => ({
	id: crypto.randomUUID(),
	scopeId: crypto.randomUUID(),
	subscriptionId: crypto.randomUUID(),
});
test("browser-open IPC identities reject foreign fields and incomplete scope proofs", () => {
	const input = identity();
	expect(browserOpenIdentitySchema.parse(input)).toEqual(input);
	for (const field of ["id", "scopeId", "subscriptionId"]) {
		const copy: Record<string, unknown> = { ...input };
		delete copy[field];
		expect(browserOpenIdentitySchema.safeParse(copy).success).toBe(false);
		expect(
			browserOpenIdentitySchema.safeParse({ ...input, [field]: "not-a-uuid" })
				.success,
		).toBe(false);
	}
	expect(
		browserOpenIdentitySchema.safeParse({ ...input, ownerId: 8 }).success,
	).toBe(false);
	expect(browserOpenScopeSchema.safeParse(input).success).toBe(false);
	expect(browserOpenSubscriptionSchema.safeParse(input).success).toBe(false);
});
test("browser-open replies strictly bound results and errors without changing success shape", () => {
	const input = {
		...identity(),
		ok: true as const,
		result: {
			paneId: "owned-pane",
			url: "http://localhost:3000/中文",
			title: "标题",
		},
	};
	expect(browserOpenReplySchema.parse(input)).toEqual(input);
	for (const result of [
		{ ...input.result, paneId: "foreign/pane" },
		{ ...input.result, url: "http://localhost/\n" },
		{ ...input.result, title: "x".repeat(4097) },
		{ ...input.result, webContentsId: 42 },
	])
		expect(browserOpenReplySchema.safeParse({ ...input, result }).success).toBe(
			false,
		);
	expect(
		browserOpenReplySchema.safeParse({
			...identity(),
			ok: false,
			error: "Cancelled",
		}).success,
	).toBe(true);
	expect(
		browserOpenReplySchema.safeParse({
			...identity(),
			ok: false,
			error: "x".repeat(4097),
		}).success,
	).toBe(false);
	expect(
		browserOpenReplySchema.safeParse({ ...input, error: "unexpected" }).success,
	).toBe(false);
});
test("browser-open saves require request identity and preserve original view validation ownership", () => {
	const input = {
		...identity(),
		save: {
			expectedRevision: 0,
			navigationRevision: 0,
			view: { untrusted: true },
			browserLeases: [{ connectionId: crypto.randomUUID(), generation: 1 }],
		},
	};
	expect(browserOpenSaveSchema.parse(input)).toEqual(input);
	expect(
		browserOpenSaveSchema.safeParse({
			...input,
			save: { ...input.save, expectedRevision: -1 },
		}).success,
	).toBe(false);
	expect(
		browserOpenSaveSchema.safeParse({
			...input,
			save: { ...input.save, force: true },
		}).success,
	).toBe(false);
	expect(
		browserOpenSaveSchema.safeParse({
			...input,
			save: {
				...input.save,
				browserLeases: [{ ...input.save.browserLeases[0], generation: 0 }],
			},
		}).success,
	).toBe(false);
});
