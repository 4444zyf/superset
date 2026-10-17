import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunCompletionStore, supportsRunCompletion } from "./run-completion";
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const run = {
	workspaceId: "workspace",
	operationId: "bbed79ba-4ca0-4ea4-8153-a6baf120a2fc",
};
test.each([
	"/bin/bash",
	"/usr/bin/zsh",
])("%s reports a rapid failure while keeping the configured shell's cwd and variables", (shell) => {
	const root = mkdtempSync(join(tmpdir(), "run completion-"));
	roots.push(root);
	const store = new RunCompletionStore(join(root, "private"));
	const command = store.prepare(
		run,
		shell,
		`cd '${root}'; export REMIX_TEST_VALUE=kept; false`,
	);
	expect(store.read(run)).toBeNull();
	execFileSync(shell, [
		"-c",
		`${command}\n[ "$REMIX_TEST_VALUE" = kept ] && pwd > '${root}/cwd'`,
	]);
	expect(readFileSync(join(root, "cwd"), "utf8")).toBe(root + "\n");
	expect(store.read(run)).toBe(1);
	expect(new RunCompletionStore(join(root, "private")).read(run)).toBe(1);
	expect(store.read({ ...run, operationId: "different" })).toBeNull();
	store.remove(run.workspaceId);
	expect(store.read(run)).toBeNull();
});
test("a successful command ending with a comment has an atomic bounded completion result", () => {
	const root = mkdtempSync(join(tmpdir(), "run-completion-"));
	roots.push(root);
	const store = new RunCompletionStore(root);
	execFileSync("/bin/bash", [
		"-c",
		store.prepare(run, "/bin/bash", "printf 'done\\n' # trailing comment"),
	]);
	expect(store.read(run)).toBe(0);
	expect(supportsRunCompletion("/usr/bin/fish")).toBe(false);
});

test("invalid command syntax returns a completion instead of leaving the shell waiting for more input", () => {
	const root = mkdtempSync(join(tmpdir(), "run-completion-syntax-"));
	roots.push(root);
	const store = new RunCompletionStore(root);
	try {
		execFileSync(
			"/bin/bash",
			["-c", store.prepare(run, "/bin/bash", "echo 'unterminated")],
			{ stdio: "ignore" },
		);
	} catch {}
	expect(store.read(run)).toBe(2);
});
