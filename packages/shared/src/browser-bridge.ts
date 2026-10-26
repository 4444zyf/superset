import { z } from "zod";

export interface BrowserPane {
	paneId: string;
	workspaceId: string | null;
	url: string;
	title: string;
	isLoading: boolean;
}

export interface ConsoleEntry {
	level: string;
	message: string;
	timestamp: number;
}

export const BROWSER_BRIDGE_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
export const BROWSER_CAPTURE_CHUNK_CHARS = 64 * 1024;
export const BROWSER_CAPTURE_MAX_BASE64_CHARS = 32 * 1024 * 1024;
export const browserBridgeIdentitySchema = z.object({
	backendId: z.string().min(1).max(128),
	namespaceId: z.string().min(1).max(128),
	instanceId: z.string().min(1).max(128),
});
const features = z.array(z.string().max(64)).max(32);
const workspaceId = z.string().min(1).max(256);
export const browserBridgeReadOperationSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("list"), workspaceId }),
	z.object({
		type: z.literal("console"),
		workspaceId,
		paneId: z.string().min(1).max(256),
	}),
]);
export const browserBridgeListResultSchema = z.object({
	panes: z
		.array(
			z.object({
				paneId: z.string(),
				workspaceId: z.string().nullable(),
				url: z.string(),
				title: z.string(),
				isLoading: z.boolean(),
			}),
		)
		.max(128),
});
export const browserBridgeConsoleResultSchema = z.object({
	entries: z
		.array(
			z.object({
				level: z.string(),
				message: z.string(),
				timestamp: z.number(),
			}),
		)
		.max(500),
});
export const browserBridgeCaptureRequestSchema = z.object({
	type: z.literal("capture-request"),
	id: z.string().uuid(),
	workspaceId,
	paneId: z.string().min(1).max(256),
});
export const browserBridgeNavigateRequestSchema = z.strictObject({
	type: z.literal("navigate-request"),
	id: z.string().uuid(),
	workspaceId,
	paneId: z.string().min(1).max(256),
	url: z
		.string()
		.min(1)
		.max(8192)
		.regex(/^[^\x00-\x1f\x7f]+$/),
});
export const browserBridgeEvaluateRequestSchema = z.strictObject({
	type: z.literal("evaluate-request"),
	id: z.string().uuid(),
	workspaceId,
	paneId: z.string().min(1).max(256),
	code: z.string().max(1_000_000),
});
const evaluateResultSchema = z.discriminatedUnion("ok", [
	z.object({
		type: z.literal("evaluate-result"),
		id: z.string().uuid(),
		ok: z.literal(true),
		result: z.unknown().optional(),
	}),
	z.object({
		type: z.literal("evaluate-result"),
		id: z.string().uuid(),
		ok: z.literal(false),
		error: z.object({ message: z.string().max(4096) }),
	}),
]);
const navigateResultSchema = z.discriminatedUnion("ok", [
	z.object({
		type: z.literal("navigate-result"),
		id: z.string().uuid(),
		ok: z.literal(true),
	}),
	z.object({
		type: z.literal("navigate-result"),
		id: z.string().uuid(),
		ok: z.literal(false),
		error: z.object({ message: z.string().max(4096) }),
	}),
]);
const captureChunkSchema = z.object({
	type: z.literal("capture-chunk"),
	id: z.string().uuid(),
	index: z.number().int().min(0).max(511),
	base64: z
		.string()
		.min(4)
		.max(BROWSER_CAPTURE_CHUNK_CHARS)
		.regex(/^[A-Za-z0-9+/]+={0,2}$/)
		.refine((value) => value.length % 4 === 0),
});
const captureDoneSchema = z.discriminatedUnion("ok", [
	z.object({
		type: z.literal("capture-done"),
		id: z.string().uuid(),
		ok: z.literal(true),
		chunks: z.number().int().min(1).max(512),
		base64Chars: z.number().int().min(12).max(BROWSER_CAPTURE_MAX_BASE64_CHARS),
	}),
	z.object({
		type: z.literal("capture-done"),
		id: z.string().uuid(),
		ok: z.literal(false),
		error: z.object({ message: z.string().max(4096) }),
	}),
]);
export const browserBridgePacketSchema = z.union([
	browserBridgeIdentitySchema.extend({
		type: z.literal("hello"),
		protocol: z.literal(1),
		features,
	}),
	browserBridgeIdentitySchema.extend({
		type: z.literal("ready"),
		protocol: z.literal(1),
		features,
	}),
	z.object({
		type: z.literal("request"),
		id: z.string().uuid(),
		operation: browserBridgeReadOperationSchema,
	}),
	z.object({
		type: z.literal("result"),
		id: z.string().uuid(),
		ok: z.literal(true),
		value: z.unknown(),
	}),
	z.object({
		type: z.literal("result"),
		id: z.string().uuid(),
		ok: z.literal(false),
		error: z.object({ message: z.string().max(4096) }),
	}),
	browserBridgeCaptureRequestSchema,
	captureChunkSchema,
	captureDoneSchema,
	browserBridgeNavigateRequestSchema,
	navigateResultSchema,
	browserBridgeEvaluateRequestSchema,
	evaluateResultSchema,
]);

export function validateBrowserCaptureBase64(base64: string): void {
	if (
		base64.length > BROWSER_CAPTURE_MAX_BASE64_CHARS ||
		base64.length % 4 !== 0 ||
		!base64.startsWith("iVBORw0KGgo") ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
	)
		throw Error("Invalid or oversized browser PNG");
}

export function* browserCapturePackets(
	id: string,
	base64: string,
): Generator<BrowserBridgePacket> {
	validateBrowserCaptureBase64(base64);
	let index = 0;
	for (
		let offset = 0;
		offset < base64.length;
		offset += BROWSER_CAPTURE_CHUNK_CHARS
	)
		yield {
			type: "capture-chunk",
			id,
			index: index++,
			base64: base64.slice(offset, offset + BROWSER_CAPTURE_CHUNK_CHARS),
		};
	yield {
		type: "capture-done",
		id,
		ok: true,
		chunks: index,
		base64Chars: base64.length,
	};
}

export type BrowserBridgeIdentity = z.infer<typeof browserBridgeIdentitySchema>;
export type BrowserBridgeReadOperation = z.infer<
	typeof browserBridgeReadOperationSchema
>;
export type BrowserBridgePacket = z.infer<typeof browserBridgePacketSchema>;
export type BrowserBridgeListResult = z.infer<
	typeof browserBridgeListResultSchema
>;
export type BrowserBridgeConsoleResult = z.infer<
	typeof browserBridgeConsoleResultSchema
>;

export function parseBrowserBridgePacket(raw: string): BrowserBridgePacket {
	if (
		raw.length > BROWSER_BRIDGE_MAX_MESSAGE_BYTES ||
		new TextEncoder().encode(raw).byteLength > BROWSER_BRIDGE_MAX_MESSAGE_BYTES
	)
		throw Error("Browser bridge message is too large");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw Error("Invalid browser bridge message");
	}
	const parsed = browserBridgePacketSchema.safeParse(value);
	if (!parsed.success) throw Error("Invalid browser bridge message");
	return parsed.data;
}

export function encodeBrowserBridgePacket(packet: BrowserBridgePacket): string {
	const raw = JSON.stringify(packet);
	parseBrowserBridgePacket(raw);
	return raw;
}
