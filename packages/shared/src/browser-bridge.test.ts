import { expect, test } from "bun:test";
import {
	BROWSER_BRIDGE_MAX_MESSAGE_BYTES,
	browserBridgeConsoleResultSchema,
	browserBridgeListResultSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "./browser-bridge";

test("browser bridge frames round-trip typed scope and preserve optional feature negotiation", () => {
	const packet = {
		type: "hello" as const,
		protocol: 1 as const,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		features: ["readV1", "future-feature"],
	};
	expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(packet))).toEqual(
		packet,
	);
	expect(() => parseBrowserBridgePacket("PRIVATE-OWNED-INVALID-JSON")).toThrow(
		"Invalid browser bridge message",
	);
});

test("the message budget counts UTF-8 bytes rather than JavaScript characters", () => {
	const raw = JSON.stringify({
		type: "result",
		id: crypto.randomUUID(),
		ok: true,
		value: "中".repeat(BROWSER_BRIDGE_MAX_MESSAGE_BYTES / 2),
	});
	expect(raw.length).toBeLessThan(BROWSER_BRIDGE_MAX_MESSAGE_BYTES);
	expect(() => parseBrowserBridgePacket(raw)).toThrow(
		"Browser bridge message is too large",
	);
});

test("read results retain the original pane and console shapes within the negotiated bounds", () => {
	const pane = {
		paneId: "page",
		workspaceId: "owned",
		url: "http://localhost/owned",
		title: "Owned",
		isLoading: false,
	};
	const entry = { level: "info", message: "Owned console", timestamp: 1 };
	expect(browserBridgeListResultSchema.parse({ panes: [pane] })).toEqual({
		panes: [pane],
	});
	expect(browserBridgeConsoleResultSchema.parse({ entries: [entry] })).toEqual({
		entries: [entry],
	});
	expect(
		browserBridgeListResultSchema.safeParse({ panes: Array(129).fill(pane) })
			.success,
	).toBe(false);
	expect(
		browserBridgeConsoleResultSchema.safeParse({
			entries: Array(501).fill(entry),
		}).success,
	).toBe(false);
});
