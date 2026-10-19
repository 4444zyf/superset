import { expect, test } from "bun:test";
import { terminalScriptInputSchema } from "./terminal-script-operation";

test("a sequential script within the stored catalog budget remains an accepted command", () => {
	const text = "#".repeat(300 * 1024) + "\nprintf done";
	expect(
		terminalScriptInputSchema.safeParse({
			workspaceId: "workspace",
			terminalId: "terminal",
			executionId: "execution",
			text,
		}).success,
	).toBe(true);
});
