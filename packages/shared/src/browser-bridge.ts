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
]);

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
