import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { HostServiceContext } from "../../../types";
import { gitRouter } from "./git";

async function repository() {
	const root = mkdtempSync(join(tmpdir(), "superset-branch-sync-"));
	const remote = join(root, "remote.git"),
		sender = join(root, "sender"),
		receiver = join(root, "receiver");
	mkdirSync(sender);
	mkdirSync(receiver);
	await simpleGit(root).raw(["init", "--bare", remote]);
	const git = simpleGit(sender);
	await git.init();
	await git.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
	await git.raw(["config", "user.name", "Sync Author"]);
	await git.raw(["config", "user.email", "sync@example.invalid"]);
	await git.raw(["config", "commit.gpgsign", "false"]);
	writeFileSync(join(sender, "base.txt"), "base\n");
	await git.add("base.txt");
	await git.commit("base");
	await git.addRemote("origin", remote);
	await git.raw(["push", "-u", "origin", "main"]);
	await simpleGit(root).raw(["clone", "--branch", "main", remote, receiver]);
	const local = simpleGit(receiver);
	await local.raw(["config", "user.name", "Sync Author"]);
	await local.raw(["config", "user.email", "sync@example.invalid"]);
	await local.raw(["config", "commit.gpgsign", "false"]);
	const ctx = {
		isAuthenticated: true,
		db: {
			query: {
				workspaces: {
					findFirst: () => ({ sync: () => ({ worktreePath: receiver }) }),
				},
			},
		},
		git: async (path: string) => simpleGit(path),
		credentials: {
			getCredentials: async () => ({ env: {} }),
			getToken: async () => null,
		},
	} as unknown as HostServiceContext;
	return {
		root,
		remote,
		sender,
		receiver,
		git,
		local,
		caller: gitRouter.createCaller(ctx),
	};
}
test("fetch updates tracking without changing worktree; pull rebases from the selected repository", async () => {
	const f = await repository();
	try {
		const before = await f.local.revparse("HEAD");
		writeFileSync(join(f.sender, "remote.txt"), "remote update\n");
		await f.git.add("remote.txt");
		await f.git.commit("remote update");
		await f.git.push();
		await f.caller.syncBranchV1({ workspaceId: "workspace", action: "fetch" });
		expect(await f.local.revparse("HEAD")).toBe(before);
		expect(existsSync(join(f.receiver, "remote.txt"))).toBe(false);
		expect(
			(await f.caller.getBranchSyncStatus({ workspaceId: "workspace" }))
				.pullCount,
		).toBe(1);
		await f.caller.syncBranchV1({ workspaceId: "workspace", action: "pull" });
		expect(readFileSync(join(f.receiver, "remote.txt"), "utf8")).toBe(
			"remote update\n",
		);
		expect(await f.local.revparse("HEAD")).toBe(await f.git.revparse("HEAD"));
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
test("sync rebases divergent local commits and pushes the result with both sides retained", async () => {
	const f = await repository();
	try {
		writeFileSync(join(f.sender, "remote.txt"), "remote\n");
		await f.git.add("remote.txt");
		await f.git.commit("remote update");
		await f.git.push();
		writeFileSync(join(f.receiver, "local.txt"), "local\n");
		await f.local.add("local.txt");
		await f.local.commit("local update");
		await f.caller.syncBranchV1({ workspaceId: "workspace", action: "sync" });
		expect(readFileSync(join(f.receiver, "remote.txt"), "utf8")).toBe(
			"remote\n",
		);
		expect(readFileSync(join(f.receiver, "local.txt"), "utf8")).toBe("local\n");
		expect(await simpleGit(f.remote).raw(["rev-parse", "main"])).toBe(
			await f.local.raw(["rev-parse", "HEAD"]),
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
test("a conflicting sync leaves the real rebase for resolution and never pushes or discards it", async () => {
	const f = await repository();
	try {
		writeFileSync(join(f.sender, "base.txt"), "remote\n");
		await f.git.add("base.txt");
		await f.git.commit("remote change");
		await f.git.push();
		const remoteHead = await f.git.revparse("HEAD");
		writeFileSync(join(f.receiver, "base.txt"), "local\n");
		await f.local.add("base.txt");
		await f.local.commit("local change");
		let error: unknown;
		try {
			await f.caller.syncBranchV1({ workspaceId: "workspace", action: "sync" });
		} catch (result) {
			error = result;
		}
		expect(error).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(readFileSync(join(f.receiver, "base.txt"), "utf8")).toContain(
			"<<<<<<<",
		);
		expect((await f.local.status()).conflicted).toEqual(["base.txt"]);
		expect((await simpleGit(f.remote).raw(["rev-parse", "main"])).trim()).toBe(
			remoteHead,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("sync publishes an unpublished local branch when no upstream exists", async () => {
	const f = await repository();
	try {
		await f.local.raw(["switch", "--no-track", "-c", "unpublished"]);
		await f.caller.syncBranchV1({ workspaceId: "workspace", action: "sync" });
		expect(
			(await f.caller.getBranchSyncStatus({ workspaceId: "workspace" }))
				.hasUpstream,
		).toBe(true);
		expect(await simpleGit(f.remote).revparse("unpublished")).toBe(
			await f.local.revparse("HEAD"),
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
