import { expect, test } from "bun:test";
import { isMachOBinary } from "./direct-codesign";

test("release signing recognizes thin and universal Mach-O payloads without treating scripts or ELF as Mac code", () => {
	for (const magic of [
		"feedface",
		"feedfacf",
		"cefaedfe",
		"cffaedfe",
		"cafebabe",
		"bebafeca",
		"cafebabf",
		"bfbafeca",
	])
		expect(isMachOBinary(Buffer.from(magic, "hex"))).toBe(true);
	expect(isMachOBinary(Buffer.from("#!/bin/sh"))).toBe(false);
	expect(isMachOBinary(Buffer.from("7f454c46", "hex"))).toBe(false);
	expect(isMachOBinary(Buffer.alloc(3))).toBe(false);
});
