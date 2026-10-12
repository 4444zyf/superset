import { expect, test } from "bun:test";
import { directCodesignArguments, isMachOBinary } from "./direct-codesign";

test("ad-hoc code signing requires an explicit development preview and production retains timestamped certificate signing", () => {
	expect(() => directCodesignArguments("-", "entitlements.plist")).toThrow(
		"explicit development preview",
	);
	expect(directCodesignArguments("-", "entitlements.plist", true)).toContain(
		"--timestamp=none",
	);
	expect(
		directCodesignArguments("a".repeat(40), "entitlements.plist"),
	).toContain("--timestamp");
	expect(() =>
		directCodesignArguments("untrusted", "entitlements.plist", true),
	).toThrow("certificate identity");
});

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
