import { expect, test } from "bun:test";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import { currentWorkstationBrowserBridgePanes } from "./workstation-browser-bridge-panes";

function fixture(
	normalizePng?: (base64: string) => string,
	navigate?: Parameters<
		typeof currentWorkstationBrowserBridgePanes
	>[0]["navigate"],
) {
	let active = true,
		key: string | null = "owned-manager-key";
	let afterMetadata: () => void = () => {};
	const descriptor: DirectDescriptor = {
		connectionId: crypto.randomUUID(),
		generation: 1,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	};
	const pane: WorkstationBrowserPane = {
		connectionId: descriptor.connectionId,
		generation: 1,
		workspaceId: "owned",
		paneId: "page",
		registrationId: crypto.randomUUID(),
	};
	const calls: unknown[][] = [];
	const capture = Promise.withResolvers<string>(),
		evaluation = Promise.withResolvers<unknown>();
	const source = currentWorkstationBrowserBridgePanes({
		ownerId: 7,
		normalizePng,
		navigate,
		descriptor,
		isCurrent: () => active,
		registry: {
			listRegistrations: (owner, target, workspaceId) => {
				calls.push(["registrations", owner, target, workspaceId]);
				return key &&
					owner === 7 &&
					target.backendId === "backend" &&
					(workspaceId === undefined || workspaceId === pane.workspaceId)
					? [{ ...pane }]
					: [];
			},
			getManagerPaneId: (owner, input) => {
				const candidate = input as WorkstationBrowserPane;
				return owner === 7 && candidate.registrationId === pane.registrationId
					? key
					: null;
			},
		},
		manager: {
			getWebContents: (managerKey, workspaceId) => {
				calls.push(["guest", managerKey, workspaceId]);
				return managerKey === key && workspaceId === pane.workspaceId
					? {
							getURL: () => "http://127.0.0.1:48000/owned?q=1",
							getTitle: () => {
								afterMetadata();
								return "Owned page";
							},
							isLoading: () => false,
						}
					: null;
			},
			capturePng: async (managerKey, workspaceId) => {
				calls.push(["capture", managerKey, workspaceId]);
				return capture.promise;
			},
			evaluateJS: async (managerKey, code, workspaceId) => {
				calls.push(["eval", managerKey, code, workspaceId]);
				return evaluation.promise;
			},
			getConsoleLogs: (managerKey, workspaceId) => {
				calls.push(["console", managerKey, workspaceId]);
				return [
					{ level: "info" as const, message: "Owned console", timestamp: 1 },
				];
			},
		},
		canonical: (owner, registration, raw) => {
			calls.push(["canonical", owner, registration, raw]);
			return raw.replace("127.0.0.1:48000", "localhost:3000");
		},
	});
	return {
		source,
		descriptor,
		pane,
		calls,
		capture,
		evaluation,
		retire: () => {
			active = false;
		},
		replace: () => {
			key = "replacement-manager-key";
		},
		onMetadata: (callback: () => void) => {
			afterMetadata = callback;
		},
	};
}

test("bridge metadata exposes public pane IDs and canonical URLs through only the pinned manager key", () => {
	const f = fixture();
	const original = { ...f.descriptor };
	f.descriptor.backendId = "changed-by-caller";
	expect(f.source.listPanes("owned")).toEqual([
		{
			paneId: "page",
			workspaceId: "owned",
			url: "http://localhost:3000/owned?q=1",
			title: "Owned page",
			isLoading: false,
		},
	]);
	expect(f.calls[0]).toEqual(["registrations", 7, original, "owned"]);
	expect(f.calls.filter((call) => call[0] === "guest")).toEqual([
		["guest", "owned-manager-key", "owned"],
	]);
});

test("capture, evaluation and console keep the original result values and target the resolved registration", async () => {
	const f = fixture();
	f.capture.resolve("owned-png");
	f.evaluation.resolve(undefined);
	expect(await f.source.capturePng("page", "owned")).toBe("owned-png");
	expect(await f.source.evaluateJS("page", "void 0", "owned")).toBeUndefined();
	expect(f.source.getConsoleLogs("page", "owned")).toEqual([
		{ level: "info", message: "Owned console", timestamp: 1 },
	]);
	expect(
		f.calls.filter((call) =>
			["capture", "eval", "console"].includes(String(call[0])),
		),
	).toEqual([
		["capture", "owned-manager-key", "owned"],
		["eval", "owned-manager-key", "void 0", "owned"],
		["console", "owned-manager-key", "owned"],
	]);
});

test("missing or foreign workspace and pane identities cannot reach the original manager", async () => {
	const f = fixture();
	await expect(f.source.capturePng("page")).rejects.toThrow("workspaceId");
	await expect(
		f.source.evaluateJS("page", "void 0", "foreign"),
	).rejects.toThrow("No live pane");
	expect(() => f.source.getConsoleLogs("unknown", "owned")).toThrow(
		"No live pane",
	);
	expect(
		f.calls.filter((call) =>
			["capture", "eval", "console"].includes(String(call[0])),
		),
	).toEqual([]);
});

test("retired window epochs cannot list or start another operation", async () => {
	const f = fixture();
	f.retire();
	expect(() => f.source.listPanes("owned")).toThrow("no longer current");
	await expect(f.source.capturePng("page", "owned")).rejects.toThrow(
		"no longer current",
	);
	expect(f.calls).toEqual([]);
});

test("a replaced registration withholds a late screenshot", async () => {
	const f = fixture();
	const reading = f.source.capturePng("page", "owned");
	f.replace();
	f.capture.resolve("old-private-pixels");
	await expect(reading).rejects.toThrow("no longer current");
});

test("a retired epoch withholds a late evaluation result", async () => {
	const f = fixture();
	const reading = f.source.evaluateJS("page", "document.title", "owned");
	f.retire();
	f.evaluation.resolve("old-document-result");
	await expect(reading).rejects.toThrow("no longer current");
});

test("metadata collected during an owner change is not returned", () => {
	const f = fixture();
	f.onMetadata(f.retire);
	expect(() => f.source.listPanes("owned")).toThrow("no longer current");
});

test("PNG normalization cannot publish a capture after its registration changes", async () => {
	const f = fixture((base64) => {
		f.replace();
		return base64;
	});
	const capture = f.source.capturePng("page", "owned").catch((error) => error);
	f.capture.resolve("owned-private-pixels");
	expect(await capture).toMatchObject({
		message: "Browser pane is no longer current",
	});
});

test("navigation pins the current public pane before invoking the original scoped navigator", async () => {
	const calls: unknown[] = [];
	const f = fixture(undefined, async (owner, pane, url, current) => {
		calls.push([owner, pane, url, current()]);
		return { status: "navigated", url, guestUrl: url };
	});
	const execute = f.source.pinNavigation(
		"page",
		"owned",
		"http://localhost:3000/中文",
	);
	expect(calls).toEqual([]);
	expect(await execute()).toEqual({ ok: true });
	expect(calls).toEqual([[7, f.pane, "http://localhost:3000/中文", true]]);
});

test("a navigation acknowledgement from a replaced pane cannot complete successfully", async () => {
	const done = Promise.withResolvers<{
		status: "navigated";
		url: string;
		guestUrl: string;
	}>();
	const f = fixture(undefined, () => done.promise);
	const pending = f.source
		.pinNavigation("page", "owned", "http://localhost:3000")()
		.catch((error) => error);
	f.replace();
	done.resolve({
		status: "navigated",
		url: "http://localhost:3000",
		guestUrl: "http://127.0.0.1:48000",
	});
	expect(await pending).toMatchObject({
		message: "Browser pane is no longer current",
	});
});

test("navigation cannot pin a pane from another workspace", () => {
	let calls = 0;
	const f = fixture(undefined, async () => {
		calls++;
		return { status: "navigated", url: "", guestUrl: "" };
	});
	expect(() =>
		f.source.pinNavigation("page", "other", "http://localhost:3000"),
	).toThrow("No live pane");
	expect(calls).toBe(0);
});

test("evaluation pins the public pane and defers the original manager execution", async () => {
	const f = fixture();
	const execute = f.source.pinEvaluation("page", "owned", "document.title");
	expect(f.calls.filter((c) => c[0] === "eval")).toEqual([]);
	const pending = execute();
	f.evaluation.resolve(false);
	expect(await pending).toEqual({ result: false });
	expect(f.calls.filter((c) => c[0] === "eval")).toEqual([
		["eval", "owned-manager-key", "document.title", "owned"],
	]);
});

test("evaluation refuses a replaced pane before dispatch and discards its late result", async () => {
	const before = fixture(),
		pinned = before.source.pinEvaluation("page", "owned", "document.title");
	before.replace();
	await expect(pinned()).rejects.toThrow("no longer current");
	expect(before.calls.filter((c) => c[0] === "eval")).toEqual([]);
	const after = fixture();
	const pending = after.source.pinEvaluation(
		"page",
		"owned",
		"document.title",
	)();
	after.replace();
	after.evaluation.resolve(0);
	await expect(pending).rejects.toThrow("no longer current");
});

test("evaluation cannot pin another workspace or a retired owner", () => {
	const f = fixture();
	expect(() =>
		f.source.pinEvaluation("page", "other", "document.title"),
	).toThrow("No live pane");
	f.retire();
	expect(() =>
		f.source.pinEvaluation("page", "owned", "document.title"),
	).toThrow("no longer current");
});
