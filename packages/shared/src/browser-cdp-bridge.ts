import { z } from "zod";
import { BROWSER_CAPTURE_MAX_BASE64_CHARS } from "./browser-bridge";

export const BROWSER_CDP_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const BROWSER_CDP_MAX_RESPONSE_BYTES =
	BROWSER_CAPTURE_MAX_BASE64_CHARS + 64 * 1024;
export const BROWSER_CDP_MAX_PACKET_BYTES =
	Math.max(
		BROWSER_CDP_MAX_REQUEST_BYTES * 6,
		BROWSER_CDP_MAX_RESPONSE_BYTES * 2,
	) + 4096;
export const BROWSER_CDP_ACK_TIMEOUT_MS = 15_000;

export function assertBrowserCdpRaw(
	raw: string,
	maxBytes = BROWSER_CDP_MAX_REQUEST_BYTES,
): void {
	if (
		typeof raw !== "string" ||
		raw.length > maxBytes ||
		new TextEncoder().encode(raw).byteLength > maxBytes
	)
		throw Error("Browser CDP message is too large or is not text");
}

const sessionId = z.string().uuid();
const code = z.union([
	z.literal(1000),
	z.literal(1001),
	z.literal(1008),
	z.literal(1009),
	z.literal(1011),
	z.literal(1013),
]);
const rawSchema = (maxBytes: number) =>
	z
		.string()
		.max(maxBytes)
		.refine((value) => new TextEncoder().encode(value).byteLength <= maxBytes);
const openResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		type: z.literal("cdp-open-result"),
		sessionId,
		ok: z.literal(true),
	}),
	z.strictObject({
		type: z.literal("cdp-open-result"),
		sessionId,
		ok: z.literal(false),
		code,
	}),
]);
export const browserCdpPacketSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("cdp-open"),
		sessionId,
		workspaceId: z.string().min(1).max(256),
		paneId: z.string().min(1).max(256),
	}),
	openResultSchema,
	z.strictObject({
		type: z.literal("cdp-input"),
		sessionId,
		raw: rawSchema(BROWSER_CDP_MAX_REQUEST_BYTES),
	}),
	z.strictObject({
		type: z.literal("cdp-output"),
		sessionId,
		raw: rawSchema(BROWSER_CDP_MAX_RESPONSE_BYTES),
	}),
	z.strictObject({ type: z.literal("cdp-close"), sessionId, code }),
]);
export type BrowserCdpPacket = z.infer<typeof browserCdpPacketSchema>;

export function parseBrowserCdpPacket(raw: string): BrowserCdpPacket {
	if (
		raw.length > BROWSER_CDP_MAX_PACKET_BYTES ||
		new TextEncoder().encode(raw).byteLength > BROWSER_CDP_MAX_PACKET_BYTES
	)
		throw Error("Browser CDP packet is too large");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw Error("Invalid browser CDP packet");
	}
	const parsed = browserCdpPacketSchema.safeParse(value);
	if (!parsed.success) throw Error("Invalid browser CDP packet");
	return parsed.data;
}

export function encodeBrowserCdpPacket(packet: BrowserCdpPacket): string {
	const raw = JSON.stringify(packet);
	parseBrowserCdpPacket(raw);
	return raw;
}
