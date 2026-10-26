import { expect, test } from "bun:test";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import { currentWorkstationBrowserBridgePanes } from "./workstation-browser-bridge-panes";

function fixture() {
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
