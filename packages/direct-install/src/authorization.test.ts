import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeRemoteScript } from "./authorization";

test("password authorization streams a large script and keeps the password out of arguments", async () => {
	const directory = mkdtempSync(join(tmpdir(), "direct-authorization-"));
	try {
		const sudo = join(directory, "sudo");
		writeFileSync(
			sudo,
			'#!/bin/sh\nIFS= read -r password\n[ "$password" = "a\'b\\$test" ] || exit 77\nshift 3\nexec "$@"\n',
			{ mode: 0o700 },
		);
		const content = "verified-payload".repeat(100000);
		const script = `/bin/cat <<'SUPERSET_DIRECT_BOOTSTRAP'\n${content}\nSUPERSET_DIRECT_BOOTSTRAP\n`;
		const result = await authorizeRemoteScript(
			{
				upload: async () => {},
				exec: async (command, stdin) => {
					expect(command).toBe("/bin/sh -s");
					expect(command).not.toContain(content);
					expect(command).not.toContain("a'b$test");
					const process = spawnSync("/bin/sh", ["-s"], {
						input: stdin
							?.replace("/private/tmp/", `${directory}/`)
							.replace("/usr/bin/sudo", sudo),
						encoding: "utf8",
						maxBuffer: 4 * 1024 * 1024,
					});
					return {
						stdout: process.stdout,
						stderr: process.stderr,
						exitCode: process.status ?? 255,
					};
				},
			},
			script,
			"a'b$test",
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(`${content}\n`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
