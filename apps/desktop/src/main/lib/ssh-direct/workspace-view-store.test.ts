import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { WorkspaceViewInput } from "../../../shared/workspace-view";
import { WorkspaceViewStore } from "./workspace-view-store";

const view = (): WorkspaceViewInput => ({
	restoreOnLaunch: true,
	activeConnectionId: "mac",
	targets: [
		{
			connectionId: "mac",
			targetRevision: 1,
			backendId: "5b2ea852-8428-4a22-91e6-980f81432131",
			namespaceId: "18817038-3f91-4c8c-99e5-7267c6398f0a",
			serviceUid: 501,
			autoConnect: true,
			activeTabId: "tab",
			workspaces: [
				{
					tabId: "tab",
					workspaceId: "workspace",
					activeTool: "terminal",
					activePaneId: "codex",
					panes: [
						{
							paneId: "claude",
							kind: "terminal",
							resourceId: "terminal-1",
							executionId: "execution-1",
							label: "Claude",
						},
						{
							paneId: "codex",
							kind: "terminal",
							resourceId: "terminal-2",
							executionId: "execution-2",
							label: "Codex",
						},
						{
							paneId: "omp",
							kind: "terminal",
							resourceId: "terminal-3",
							executionId: "execution-3",
							label: "OMP",
						},
					],
					layout: {
						type: "split",
						axis: "horizontal",
						ratio: 0.37,
						first: { type: "pane", paneId: "claude" },
						second: {
							type: "split",
							axis: "vertical",
							ratio: 0.64,
							first: { type: "pane", paneId: "codex" },
							second: { type: "pane", paneId: "omp" },
						},
					},
				},
			],
		},
	],
	window: { x: 10, y: 20, width: 1200, height: 900, maximized: false },
});

test("three pane order, ratios and focus survive a store reopen with FULL durability", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db, () => 100);
	store.activateOwner("renderer-1");
	const saved = store.save({
		owner: "renderer-1",
		expectedRevision: 0,
		view: view(),
	});
	expect(saved.revision).toBe(1);
	const reopened = new WorkspaceViewStore(db, () => 200);
	expect(reopened.read().snapshot).toMatchObject({
		revision: 1,
		targets: view().targets,
		window: view().window,
	});
	expect(db.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
	db.close();
});

test("stale owner and revision cannot overwrite the saved layout", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db);
	store.activateOwner("old");
	store.save({ owner: "old", expectedRevision: 0, view: view() });
	store.activateOwner("new");
	expect(() =>
		store.save({ owner: "old", expectedRevision: 1, view: view() }),
	).toThrow("owner");
	expect(() =>
		store.save({ owner: "new", expectedRevision: 0, view: view() }),
	).toThrow("revision");
	expect(store.read().snapshot?.revision).toBe(1);
	db.close();
});

test("bad trees, excessive ratios and forbidden command data leave the previous snapshot untouched", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	store.save({ owner: "owner", expectedRevision: 0, view: view() });
	for (const change of ["duplicate", "ratio", "secret"]) {
		const candidate = view();
		const workspace = candidate.targets[0]?.workspaces[0];
		if (
			!workspace ||
			workspace.layout?.type !== "split" ||
			workspace.layout.first.type !== "pane"
		)
			throw new Error("Missing fixture");
		if (change === "duplicate") workspace.layout.first.paneId = "codex";
		if (change === "ratio") workspace.layout.ratio = 1;
		if (change === "secret")
			Object.assign(workspace.panes[0] ?? {}, { command: "sensitive input" });
		expect(() =>
			store.save({ owner: "owner", expectedRevision: 1, view: candidate }),
		).toThrow();
	}
	expect(store.read().snapshot?.revision).toBe(1);
	db.close();
});

test("forget advances the revision and cannot be undone by a late save", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	store.save({ owner: "owner", expectedRevision: 0, view: view() });
	store.forget({ owner: "owner", expectedRevision: 1 });
	expect(store.read().snapshot).toBeNull();
	expect(() =>
		store.save({ owner: "owner", expectedRevision: 1, view: view() }),
	).toThrow("revision");
	db.close();
});

test("an unknown future schema cannot be overwritten by normal layout or window saves", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	db.prepare("UPDATE workspace_view SET revision=9,snapshot=? WHERE id=1").run(
		JSON.stringify({ schemaVersion: 99, revision: 9, updatedAt: 100 }),
	);
	expect(store.read()).toMatchObject({
		revision: 9,
		snapshot: null,
		invalid: true,
	});
	expect(() =>
		store.save({ owner: "owner", expectedRevision: 9, view: view() }),
	).toThrow();
	expect(store.read().revision).toBe(9);
	store.forget({ owner: "owner", expectedRevision: 9 });
	expect(store.read()).toMatchObject({
		revision: 10,
		snapshot: null,
		invalid: false,
	});
	db.close();
});

test("a committed file-backed view survives force-killing its writer", async () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-view-durable-"));
	const path = join(root, "views.db");
	const script = `import {Database} from "bun:sqlite"; import {WorkspaceViewStore} from ${JSON.stringify(new URL("./workspace-view-store.ts", import.meta.url).pathname)}; const store=new WorkspaceViewStore(new Database(${JSON.stringify(path)})); store.activateOwner("writer"); store.save({owner:"writer",expectedRevision:0,view:${JSON.stringify(view())}}); process.stdout.write("COMMITTED"); setInterval(()=>{},1000);`;
	const child = spawn(process.execPath, ["-e", script], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	try {
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", () =>
				reject(new Error("Writer exited before commit")),
			);
			child.stdout.on("data", (b) => {
				if (String(b).includes("COMMITTED")) resolve();
			});
		});
		const exited = new Promise<void>((resolve) =>
			child.once("exit", () => resolve()),
		);
		child.kill("SIGKILL");
		await exited;
		const db = new Database(path);
		const reopened = new WorkspaceViewStore(db);
		expect(reopened.read().snapshot?.targets).toEqual(view().targets);
		expect(reopened.read().snapshot?.revision).toBe(1);
		reopened.close();
	} finally {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
		rmSync(root, { recursive: true, force: true });
	}
});
