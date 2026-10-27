import { expect, test } from "bun:test";
import {
	encodeBrowserBridgePacket,
	parseBrowserBridgePacket,
} from "./browser-bridge";

test("login source frames preserve original source fields and future entry metadata", () => {
	const id = crypto.randomUUID(),
		request = { type: "import-sources-request" as const, id };
	expect(parseBrowserBridgePacket(JSON.stringify(request))).toEqual(request);
	const result = {
		type: "import-sources-result" as const,
		id,
		ok: true as const,
		result: {
			sources: [
				{
					id: "/owned/配置/Default",
					browserKey: "chrome",
					browserName: "Google Chrome",
					profileName: "Owned 中文",
					future: "kept",
				},
			],
		},
	};
	expect(parseBrowserBridgePacket(JSON.stringify(result))).toEqual(result);
	expect(
		parseBrowserBridgePacket(
			encodeBrowserBridgePacket({
				type: "import-sources-result",
				id,
				ok: false,
				error: { message: "Owned failure" },
			}),
		),
	).toEqual({
		type: "import-sources-result",
		id,
		ok: false,
		error: { message: "Owned failure" },
	});
});
test("source reads reject caller-supplied profile paths and malformed or excessive lists", () => {
	const id = crypto.randomUUID(),
		source = {
			id: "/owned/Default",
			browserName: "Chrome",
			profileName: "Default",
		};
	for (const packet of [
		{ type: "import-sources-request", id, profileDir: "/foreign" },
		{
			type: "import-sources-result",
			id,
			ok: true,
			result: { sources: Array(513).fill(source) },
		},
		{
			type: "import-sources-result",
			id,
			ok: true,
			result: { sources: [{ ...source, id: "" }] },
		},
		{
			type: "import-sources-result",
			id,
			ok: true,
			result: { sources: [{ id: "/owned" }] },
		},
	])
		expect(() => parseBrowserBridgePacket(JSON.stringify(packet))).toThrow(
			"Invalid browser bridge message",
		);
});
