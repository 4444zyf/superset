import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directChatHarnesses } from "./chat-readiness";

test("direct chat availability reflects executable CLIs on B and does not invent provider authentication", () => {
	const directory = mkdtempSync(join(tmpdir(), "direct-cli-readiness-"));
	try {
		const executable = join(directory, "codex");
		writeFileSync(executable, "#!/bin/sh\nexit 0\n");
		chmodSync(executable, 0o700);
		const result = directChatHarnesses({ PATH: directory });
		expect(result.find((entry) => entry.id === "codex")).toMatchObject({
			available: true,
			authenticationChecked: false,
		});
		expect(result.find((entry) => entry.id === "claude-code")).toMatchObject({
			available: false,
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
