import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { sftpArguments, sftpUploadBatch } from "./ssh";

test("SFTP can request its subsystem without conflicting SSH session options", () => {
	const args = sftpArguments(
		{ id: "probe", name: "Probe", host: "127.0.0.1", port: 1, user: "fixture" },
		"/dev/null",
	);
	const result = spawnSync("sftp", args, { encoding: "utf8" });
	expect(result.status).not.toBe(0);
	expect(result.stderr).not.toContain("Cannot specify -s");
	expect(result.stderr).toContain("Connection refused");
	expect(args).toContain("StrictHostKeyChecking=yes");
	expect(args).toContain("ClearAllForwardings=yes");
	expect(args).toContain("User=fixture");
	expect(args).toContain("-P");
});

test("an upload batch suppresses command echo and rejects injected commands", () => {
	expect(
		sftpUploadBatch([
			{ localPath: "/local/has space", remotePath: "/remote/file" },
		]),
	).toBe('@put "/local/has space" "/remote/file"\n');
	expect(() =>
		sftpUploadBatch([
			{
				localPath: "/local/file",
				remotePath: "/remote/file\n!touch /tmp/injected",
			},
		]),
	).toThrow("Invalid SFTP path");
});
