import { expect, test } from "bun:test";
import {
	browserBridgeEvaluateRequestSchema,
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
	BROWSER_BRIDGE_MAX_MESSAGE_BYTES,
} from "./browser-bridge";

test("evaluation framing keeps original code bounds and JSON-compatible falsy results", () => {
	const id = crypto.randomUUID();
	for (const code of ["", "document.title", "a".repeat(1_000_000)])
		expect(
			browserBridgeEvaluateRequestSchema.parse({
				type: "evaluate-request",
				id,
				workspaceId: "owned",
				paneId: "page",
				code,
			}).code,
		).toBe(code);
	expect(() =>
		browserBridgeEvaluateRequestSchema.parse({
			type: "evaluate-request",
			id,
			workspaceId: "owned",
			paneId: "page",
			code: "a".repeat(1_000_001),
		}),
	).toThrow();
	for (const result of [
		false,
		0,
		null,
		"",
		undefined,
		{ message: "中文 🙂" },
	]) {
		const packet = parseBrowserBridgePacket(
			encodeBrowserBridgePacket({
				type: "evaluate-result",
				id,
				ok: true,
				result,
			}),
		);
		expect(packet).toMatchObject({ type: "evaluate-result", id, ok: true });
		if (packet.type !== "evaluate-result" || !packet.ok)
			throw Error("Wrong evaluation packet");
		expect(packet.result).toEqual(result);
	}
	expect(() =>
		encodeBrowserBridgePacket({
			type: "evaluate-result",
			id,
			ok: true,
			result: "x".repeat(BROWSER_BRIDGE_MAX_MESSAGE_BYTES),
		}),
	).toThrow("too large");
});
