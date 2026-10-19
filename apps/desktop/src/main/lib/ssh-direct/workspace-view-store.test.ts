import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function viewWithPaneTabs() {
	const input = view();
	return {
		...input,
		targets: input.targets.map((target) => ({
			...target,
			workspaces: target.workspaces.map((workspace) => ({
				...workspace,
				activePaneTabId: "terminal-tab-2" as string | null,
				paneTabs: [
					{
						tabId: "terminal-tab-1",
						label: "Pair",
						createdAt: 1,
						activePaneId: "claude",
						layout: { type: "pane" as const, paneId: "claude" },
					},
					{
						tabId: "terminal-tab-2",
						label: "Grouped",
						createdAt: 2,
						activePaneId: "codex",
						layout: {
							type: "split" as const,
							axis: "vertical" as const,
							ratio: 0.64,
							first: { type: "pane" as const, paneId: "codex" },
							second: { type: "pane" as const, paneId: "omp" },
						},
					},
				],
			})),
		})),
	};
}

test("original terminal tabs, focused pane and split ratios survive local SQLite reopen", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db, () => 100);
	store.activateOwner("renderer");
	const input = viewWithPaneTabs();
	store.save({ owner: "renderer", expectedRevision: 0, view: input });
	expect(
		new WorkspaceViewStore(db, () => 200).read().snapshot?.targets,
	).toEqual(input.targets);
	db.close();
});

test("invalid terminal tab partitions or focus cannot overwrite the saved workspace", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db);
	store.activateOwner("renderer");
	const input = viewWithPaneTabs();
	store.save({ owner: "renderer", expectedRevision: 0, view: input });
	type TabbedWorkspace = ReturnType<
		typeof viewWithPaneTabs
	>["targets"][number]["workspaces"][number];
	const mutations: ((w: TabbedWorkspace) => void)[] = [
		(w) => {
			w.paneTabs[1]!.tabId = w.paneTabs[0]!.tabId;
		},
		(w) => {
			const layout = w.paneTabs[1]!.layout;
			if (layout.type !== "split") throw new Error("expected split");
			layout.first.paneId = "missing";
		},
		(w) => {
			const layout = w.paneTabs[1]!.layout;
			if (layout.type !== "split") throw new Error("expected split");
			layout.first.paneId = "claude";
		},
		(w) => {
			w.paneTabs.pop();
			w.activePaneTabId = "terminal-tab-1";
			w.activePaneId = "claude";
		},
		(w) => {
			w.activePaneTabId = "missing";
		},
		(w) => {
			w.paneTabs[1]!.activePaneId = "claude";
		},
		(w) => {
			w.activePaneId = "claude";
		},
		(w) => {
			Reflect.deleteProperty(w, "activePaneTabId");
		},
	];
	for (const mutate of mutations) {
		const invalid = structuredClone(input);
		mutate(invalid.targets[0]!.workspaces[0]);
		expect(() =>
			store.save({ owner: "renderer", expectedRevision: 1, view: invalid }),
		).toThrow();
		expect(store.read().snapshot?.targets).toEqual(input.targets);
	}
	db.close();
});

test("an intentionally empty terminal tab collection remains empty after reopening", () => {
	const db = new Database(":memory:");
	const store = new WorkspaceViewStore(db);
	store.activateOwner("renderer");
	const input = viewWithPaneTabs();
	const workspace = input.targets[0]!.workspaces[0]!;
	workspace.panes = [];
	workspace.layout = null;
	workspace.activePaneId = null;
	workspace.paneTabs = [];
	workspace.activePaneTabId = null;
	store.save({ owner: "renderer", expectedRevision: 0, view: input });
	expect(new WorkspaceViewStore(db).read().snapshot?.targets).toEqual(
		input.targets,
	);
	db.close();
});

function localIdentity(namespaceId: string) {
	return {
		connectionId: "mac",
		targetRevision: 1,
		backendId: "backend-local",
		namespaceId,
		serviceUid: 501,
	};
}

test("local namespaces keep independent layouts and never replace SSH views on selection", () => {
	const db = new Database(":memory:"),
		store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	const a = view();
	Object.assign(a.targets[0]!, localIdentity("namespace-a"));
	a.targets[0]!.workspaces[0]!.label = "Local A";
	a.targets.push({
		...structuredClone(a.targets[0]!),
		connectionId: "ssh",
		backendId: "ssh-backend",
		namespaceId: "ssh-namespace",
	});
	store.save({ owner: "owner", expectedRevision: 0, view: a });
	store.selectLocalNamespace("owner", localIdentity("namespace-b"));
	const b = store.read().snapshot!;
	expect(b.activeConnectionId).toBeNull();
	expect(b.targets.map((t) => t.connectionId)).toEqual(["ssh"]);
	expect(() =>
		store.save({ owner: "owner", expectedRevision: 1, view: a }),
	).toThrow("revision");
	const input = {
		...b,
		targets: [
			...b.targets,
			{ ...structuredClone(a.targets[0]!), ...localIdentity("namespace-b") },
		],
	};
	const {
		schemaVersion: _,
		revision: __,
		updatedAt: ___,
		...candidate
	} = input;
	candidate.targets[1]!.workspaces[0]!.label = "Local B";
	candidate.activeConnectionId = "mac";
	store.save({ owner: "owner", expectedRevision: b.revision, view: candidate });
	store.selectLocalNamespace("owner", localIdentity("namespace-a"));
	const restored = store.read().snapshot!;
	expect(restored.targets.find((t) => t.connectionId === "mac")).toEqual({
		...a.targets[0]!,
		autoConnect: false,
	});
	expect(restored.targets.find((t) => t.connectionId === "ssh")).toEqual(
		a.targets[1],
	);
	const reopened = new WorkspaceViewStore(db);
	reopened.activateOwner("next");
	reopened.selectLocalNamespace("next", localIdentity("namespace-b"));
	expect(
		reopened.read().snapshot?.targets.find((t) => t.connectionId === "mac")
			?.workspaces[0]?.label,
	).toBe("Local B");
	expect(() =>
		reopened.selectLocalNamespace("owner", localIdentity("namespace-a")),
	).toThrow("owner");
	db.close();
});

test("forget removes inactive namespace views as well as the active view", () => {
	const db = new Database(":memory:"),
		store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	const a = view();
	Object.assign(a.targets[0]!, localIdentity("namespace-a"));
	store.save({ owner: "owner", expectedRevision: 0, view: a });
	store.selectLocalNamespace("owner", localIdentity("namespace-b"));
	store.forget({ owner: "owner", expectedRevision: store.read().revision });
	store.selectLocalNamespace("owner", localIdentity("namespace-a"));
	expect(store.read().snapshot).toBeNull();
	db.close();
});

test("an invalid archived local view cannot replace the active view", () => {
	const db = new Database(":memory:"),
		store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	const a = view();
	Object.assign(a.targets[0]!, localIdentity("namespace-a"));
	store.save({ owner: "owner", expectedRevision: 0, view: a });
	store.selectLocalNamespace("owner", localIdentity("namespace-b"));
	db.prepare("UPDATE local_namespace_views SET snapshot=?").run(
		JSON.stringify({
			...a.targets[0]!,
			workspaces: [{ command: "untrusted" }],
		}),
	);
	const before = store.read();
	expect(() =>
		store.selectLocalNamespace("owner", localIdentity("namespace-a")),
	).toThrow();
	expect(store.read()).toEqual(before);
	db.close();
});

test("removing an inactive namespace removes only its archived layout", () => {
	const db = new Database(":memory:"),
		store = new WorkspaceViewStore(db);
	store.activateOwner("owner");
	const a = view();
	Object.assign(a.targets[0]!, localIdentity("namespace-a"));
	store.save({ owner: "owner", expectedRevision: 0, view: a });
	store.selectLocalNamespace("owner", localIdentity("namespace-b"));
	const before = store.read();
	expect(() =>
		store.removeLocalNamespace("stale", "mac", "namespace-a"),
	).toThrow("owner");
	store.removeLocalNamespace("owner", "mac", "namespace-a");
	expect(store.read()).toEqual(before);
	store.selectLocalNamespace("owner", localIdentity("namespace-a"));
	expect(store.read().snapshot?.targets).toEqual([]);
	db.close();
});
