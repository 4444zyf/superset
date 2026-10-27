import { expect, test } from "bun:test";
import {
	BROWSER_COOKIE_IMPORT_ACK_TIMEOUT_MS,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "./browser-bridge";

test("cookie import frames carry only a scoped profile ID and aggregate results", () => {
	const id = crypto.randomUUID(),
		request = {
			type: "import-cookies-request" as const,
			id,
			workspaceId: "owned",
			paneId: "page",
			sourceId: "/owned/配置/Default",
		};
	expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(request))).toEqual(
		request,
	);
	const response = {
		type: "import-cookies-result" as const,
		id,
		ok: true as const,
		result: { imported: 2, skipped: 1, keyUnavailable: false },
	};
	expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(response))).toEqual(
		response,
	);
	expect(BROWSER_COOKIE_IMPORT_ACK_TIMEOUT_MS).toBe(180_000);
	const withExtra = {
		...response,
		result: { ...response.result, cookies: [{ value: "OWNED-PRIVATE-VALUE" }] },
	};
	expect(parseBrowserBridgePacket(JSON.stringify(withExtra))).toEqual(response);
});
test("cookie import frames reject arbitrary profile overrides and malformed counts", () => {
	const id = crypto.randomUUID(),
		request = {
			type: "import-cookies-request",
			id,
			workspaceId: "owned",
			paneId: "page",
			sourceId: "/owned/Default",
		};
	for (const packet of [
		{ ...request, browserKey: "foreign" },
		{ ...request, partition: "foreign" },
		{ ...request, profileDir: "/foreign" },
		{ ...request, sourceId: "" },
		{
			type: "import-cookies-result",
			id,
			ok: true,
			result: { imported: -1, skipped: 0, keyUnavailable: false },
		},
		{
			type: "import-cookies-result",
			id,
			ok: true,
			result: { imported: 0.5, skipped: 0, keyUnavailable: false },
		},
		{
			type: "import-cookies-result",
			id,
			ok: false,
			error: { kind: "internal", message: "Owned" },
		},
	])
		expect(() => parseBrowserBridgePacket(JSON.stringify(packet))).toThrow(
			"Invalid browser bridge message",
		);
});
