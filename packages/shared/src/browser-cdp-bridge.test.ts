import { expect, test } from "bun:test";
import {
	BROWSER_CDP_MAX_PACKET_BYTES,
	BROWSER_CDP_MAX_RAW_BYTES,
	encodeBrowserCdpPacket,
	parseBrowserCdpPacket,
} from "./browser-cdp-bridge";

const sessionId = "00000000-0000-4000-8000-000000000125";
test("the separate CDP wire format retains raw command whitespace and Unicode", () => {
	const raw =
		'{ "id": 1, "method": "Runtime.evaluate", "params": { "expression": "中文🙂" } }';
	const packet = { type: "cdp-message" as const, sessionId, raw };
	expect(parseBrowserCdpPacket(encodeBrowserCdpPacket(packet))).toEqual(packet);
});
test("CDP byte bounds cover the original four MiB raw budget including JSON escaping", () => {
	const raw = "\u0000".repeat(BROWSER_CDP_MAX_RAW_BYTES),
		packet = { type: "cdp-message" as const, sessionId, raw };
	const encoded = encodeBrowserCdpPacket(packet);
	expect(encoded.length).toBeLessThan(BROWSER_CDP_MAX_PACKET_BYTES);
	expect(parseBrowserCdpPacket(encoded)).toEqual(packet);
	expect(() => encodeBrowserCdpPacket({ ...packet, raw: `${raw}x` })).toThrow();
	expect(() =>
		encodeBrowserCdpPacket({
			...packet,
			raw: "中".repeat(Math.floor(BROWSER_CDP_MAX_RAW_BYTES / 3) + 1),
		}),
	).toThrow();
});
test("CDP scope fields and direction packets are versioned independently of old browser packets", () => {
	expect(
		parseBrowserCdpPacket(
			encodeBrowserCdpPacket({
				type: "cdp-open",
				sessionId,
				workspaceId: "workspace",
				paneId: "pane",
			}),
		),
	).toEqual({
		type: "cdp-open",
		sessionId,
		workspaceId: "workspace",
		paneId: "pane",
	});
	for (const value of [
		{
			type: "cdp-open",
			sessionId: "bad",
			workspaceId: "workspace",
			paneId: "pane",
		},
		{
			type: "cdp-open",
			sessionId,
			workspaceId: "workspace",
			paneId: "pane",
			browserKey: "foreign",
		},
		{ type: "cdp-close", sessionId, code: 1005 },
		{ type: "request", id: sessionId },
	])
		expect(() => parseBrowserCdpPacket(JSON.stringify(value))).toThrow();
});
