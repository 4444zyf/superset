import { expect, test } from "bun:test";
import {
	browserBridgeOpenRequestSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
	BROWSER_BRIDGE_MAX_MESSAGE_BYTES,
} from "./browser-bridge";

test("open frames retain explicit background defaults, nullable project metadata and view identity", () => {
	const id = crypto.randomUUID(),
		scopeId = crypto.randomUUID();
	const request = {
		type: "open-request" as const,
		id,
		scopeId,
		workspaceId: "owned",
		projectId: null,
		workspaceName: "中文 工作区",
		url: "localhost:3000/中文",
		target: "current-tab" as const,
		show: false,
	};
	expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(request))).toEqual(
		request,
	);
	const result = {
		type: "open-result" as const,
		id,
		scopeId,
		ok: true as const,
		result: {
			paneId: "created-pane",
			url: "http://localhost:3000/中文",
			title: "",
		},
	};
	expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(result))).toEqual(
		result,
	);
	expect(() =>
		browserBridgeOpenRequestSchema.parse({ ...request, code: "unexpected" }),
	).toThrow();
	expect(() =>
		browserBridgeOpenRequestSchema.parse({ ...request, url: "x".repeat(8193) }),
	).toThrow();
	expect(() =>
		parseBrowserBridgePacket(JSON.stringify({ ...result, scopeId: undefined })),
	).toThrow();
	expect(BROWSER_BRIDGE_MAX_MESSAGE_BYTES).toBe(4 * 1024 * 1024);
});

test("busy open availability is distinct from an invalid renderer scope", () => {
	const scopeId = crypto.randomUUID();
	for (const [ready, accepting] of [
		[true, true],
		[true, false],
		[false, false],
	]) {
		const packet = {
			type: "open-availability" as const,
			scopeId,
			ready: ready!,
			accepting: accepting!,
		};
		expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(packet))).toEqual(
			packet,
		);
	}
	expect(() =>
		parseBrowserBridgePacket(
			JSON.stringify({
				type: "open-availability",
				scopeId,
				ready: false,
				accepting: true,
			}),
		),
	).toThrow();
});
