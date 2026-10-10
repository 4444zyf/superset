import { expect, test } from "bun:test";
import { assertReleaseCapacity, parseDiskFreeBytes } from "./capacity";

test("capacity preflight accounts for upload, root verification, atomic stage and a free-space reserve", () => {
	expect(() =>
		assertReleaseCapacity(100 * 1024 * 1024, 350 * 1024 * 1024),
	).toThrow("space");
	expect(() =>
		assertReleaseCapacity(100 * 1024 * 1024, 600 * 1024 * 1024),
	).not.toThrow();
});
test("fresh Mac disk-space output is parsed without a runtime and malformed values fail closed", () => {
	expect(
		parseDiskFreeBytes(
			"Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 994662584 13432000 723323000 3% /System/Volumes/Data\n",
		),
	).toBe(723323000 * 1024);
	expect(() => parseDiskFreeBytes("Filesystem unavailable")).toThrow("disk");
});
