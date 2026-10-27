import { expect, test } from "bun:test";
import {
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "./browser-bridge";

test("reload frames preserve explicit cache mode with their own operation variants", () => {
	const id = crypto.randomUUID();
	for (const hard of [false, true]) {
		const packet = {
			type: "reload-request" as const,
			id,
			workspaceId: "owned",
			paneId: "pane",
			hard,
		};
		expect(parseBrowserBridgePacket(JSON.stringify(packet))).toEqual(packet);
	}
	for (const packet of [
		{ type: "reload-result" as const, id, ok: true as const },
		{
			type: "reload-result" as const,
			id,
			ok: false as const,
			error: { message: "Owned failure" },
		},
	])
		expect(parseBrowserBridgePacket(encodeBrowserBridgePacket(packet))).toEqual(
			packet,
		);
});

test("reload frames reject missing scope, ambiguous cache mode and extra action data", () => {
	const request = {
		type: "reload-request",
		id: crypto.randomUUID(),
		workspaceId: "owned",
		paneId: "pane",
		hard: false,
	};
	const { hard: _, ...missingHard } = request;
	for (const packet of [
		missingHard,
		{ ...request, workspaceId: "" },
		{ ...request, paneId: "" },
		{ ...request, hard: "false" },
		{ ...request, url: "https://other.invalid" },
		{ type: "reload-result", id: request.id, ok: true, code: "void 0" },
	])
		expect(() => parseBrowserBridgePacket(JSON.stringify(packet))).toThrow(
			"Invalid browser bridge message",
		);
});
