import { expect, test } from "bun:test";
import { directPublisher } from "./direct-publisher";

test("release publishing follows the current GitHub repository and local packages use the configured fork", () => {
	expect(directPublisher("4444zyf/superset")).toEqual({
		provider: "github",
		owner: "4444zyf",
		repo: "superset",
	});
	expect(directPublisher()).toEqual({
		provider: "github",
		owner: "4444zyf",
		repo: "superset",
	});
	expect(directPublisher("another-team/my-fork").repo).toBe("my-fork");
});

test("a publisher repository cannot be an arbitrary URL or malformed owner/path", () => {
	for (const repository of [
		"",
		"https://github.com/a/b",
		"a/b/other",
		"bad_owner/repo",
		"a/..",
		"-a/b",
		"a/b\n",
	])
		expect(() => directPublisher(repository)).toThrow("GITHUB_REPOSITORY");
});
