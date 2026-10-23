import { expect, test } from "bun:test";
import { decodeTerminalBinaryInput } from "./terminal-binary-input";

test("binary input preserves high legacy mouse coordinates and rejects malformed payloads", () => {
	const bytes = Buffer.from([27, 91, 77, 96, 200, 255]);
	expect(decodeTerminalBinaryInput(bytes.toString("base64"))).toEqual(bytes);
	for (const value of [null, 42, "!!!!", "AA=", "A".repeat(65540)])
		expect(decodeTerminalBinaryInput(value)).toBeNull();
});
