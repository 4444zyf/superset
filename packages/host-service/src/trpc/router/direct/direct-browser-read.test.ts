import { browserCapturePackets } from "@superset/shared/browser-bridge";
import { expect, test } from "bun:test";
import {
	DirectBrowserReadBridge,
	DirectBrowserBridgeError,
} from "../../../direct/browser-read-bridge";
import type { HostServiceContext } from "../../../types";
import { directRouter, describeDirectBackend } from "./direct";

const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	serviceUid: 1000,
};
const panes = [
	{
		paneId: "page",
		workspaceId: "owned",
		url: "http://localhost/owned",
		title: "Owned",
		isLoading: false,
	},
];
const entries = [{ level: "info", message: "Owned console", timestamp: 1 }];

function fixture() {
	const tasks = new Set<() => void>();
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (_delay, callback) => {
			tasks.add(callback);
			return () => {
				tasks.delete(callback);
			};
		},
	});
	const operations: unknown[] = [];
	const requested = Promise.withResolvers<void>();
	let hold = false;
	const peer = bridge.attach({
		send: (raw) => {
			const packet = JSON.parse(raw);
			if (packet.type === "capture-request") {
				operations.push({
					workspaceId: packet.workspaceId,
					paneId: packet.paneId,
				});
				requested.resolve();
				if (!hold)
					for (const part of browserCapturePackets(packet.id, "iVBORw0KGgo="))
						peer.receive(JSON.stringify(part));
				return;
			}
			if (packet.type !== "request") return;
			operations.push(packet.operation);
			requested.resolve();
			if (!hold)
				peer.receive(
					JSON.stringify({
						type: "result",
						id: packet.id,
						ok: true,
						value: packet.operation.type === "list" ? { panes } : { entries },
					}),
				);
		},
		close: () => {},
	});
	const ready = (features = ["readV1"]) =>
		peer.receive(
			JSON.stringify({
				type: "hello",
				protocol: 1,
				...identity,
				features,
			}),
		);
	const caller = (override: Partial<HostServiceContext> = {}) =>
		directRouter.createCaller({
			direct: identity,
			directBrowserReads: bridge,
			isAuthenticated: true,
			...override,
		} as HostServiceContext);
	return {
		bridge,
		peer,
		operations,
		tasks,
		requested,
		ready,
		caller,
		hold: () => {
			hold = true;
		},
	};
}

test("browser read queries retain original data envelopes through the negotiated peer", async () => {
	const f = fixture();
	try {
		f.ready();
		expect(
			await f.caller().browserReadV1({ type: "list", workspaceId: "owned" }),
		).toEqual({ panes });
		expect(
			await f.caller().browserReadV1({
				type: "console",
				workspaceId: "owned",
				paneId: "page",
			}),
		).toEqual({ entries });
		expect(f.operations).toEqual([
			{ type: "list", workspaceId: "owned" },
			{ type: "console", workspaceId: "owned", paneId: "page" },
		]);
	} finally {
		f.bridge.dispose();
	}
});

test("browser reads require the original authentication guard and an attached direct peer", async () => {
	const f = fixture();
	try {
		await expect(
			f.caller().browserReadV1({ type: "list", workspaceId: "owned" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		f.ready();
		await expect(
			f
				.caller({ isAuthenticated: false })
				.browserReadV1({ type: "list", workspaceId: "owned" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			f
				.caller({ direct: undefined })
				.browserReadV1({ type: "list", workspaceId: "owned" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(
			f
				.caller({ directBrowserReads: undefined })
				.browserReadV1({ type: "list", workspaceId: "owned" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.operations).toEqual([]);
	} finally {
		f.bridge.dispose();
	}
});

test("the new browser read input is strict and cannot request a mutation or omit its scope", async () => {
	const f = fixture();
	try {
		f.ready();
		for (const input of [
			{ type: "list" },
			{ type: "eval", workspaceId: "owned", code: "void 0" },
			{ type: "console", workspaceId: "owned" },
			{ type: "list", workspaceId: "owned", code: "void 0" },
		])
			await expect(
				f.caller().browserReadV1(input as never),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(f.operations).toEqual([]);
	} finally {
		f.bridge.dispose();
	}
});

test("disconnect maps to an expected precondition failure rather than returning a late reply", async () => {
	const f = fixture();
	try {
		f.ready();
		f.hold();
		const reading = f
			.caller()
			.browserReadV1({ type: "list", workspaceId: "owned" })
			.catch((error) => error);
		await f.requested.promise;
		f.peer.close();
		expect(await reading).toMatchObject({ code: "PRECONDITION_FAILED" });
	} finally {
		f.bridge.dispose();
	}
});

test("browser read domain failures retain explicit non-internal error classifications", async () => {
	const f = fixture();
	try {
		for (const [kind, code] of [
			["busy", "TOO_MANY_REQUESTS"],
			["timeout", "NOT_FOUND"],
			["invalid", "BAD_REQUEST"],
			["failed", "BAD_REQUEST"],
		] as const) {
			const failing = async () => {
				throw new DirectBrowserBridgeError(kind, "Owned read failed");
			};
			await expect(
				f
					.caller({
						directBrowserReads: {
							isReady: () => true,
							listPanes: failing,
							console: failing,
						},
					})
					.browserReadV1({ type: "list", workspaceId: "owned" }),
			).rejects.toMatchObject({ code, message: "Owned read failed" });
		}
	} finally {
		f.bridge.dispose();
	}
});

test("connect support and read readiness are advertised separately and expire with the peer", () => {
	const f = fixture();
	try {
		expect(
			describeDirectBackend(identity).capabilities
				.workstationBrowserReadBridgeConnectV1,
		).toBe(false);
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserReadBridgeConnectV1,
		).toBe(true);
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserReadBridgeV1,
		).toBe(false);
		f.ready();
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserReadBridgeV1,
		).toBe(true);
		f.peer.close();
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserReadBridgeV1,
		).toBe(false);
	} finally {
		f.bridge.dispose();
	}
});

test("screenshot queries require independently negotiated readiness and preserve the PNG envelope", async () => {
	const f = fixture();
	try {
		f.ready(["readV1", "capturePngV1"]);
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserCaptureV1,
		).toBe(true);
		expect(
			await f
				.caller()
				.browserCaptureV1({ workspaceId: "owned", paneId: "page" }),
		).toEqual({ base64: "iVBORw0KGgo=" });
		expect(f.operations).toEqual([{ workspaceId: "owned", paneId: "page" }]);
		f.peer.close();
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserCaptureV1,
		).toBe(false);
	} finally {
		f.bridge.dispose();
	}
});

test("screenshot queries retain authentication, require capture support and reject extra or missing scope", async () => {
	const f = fixture();
	try {
		f.ready();
		await expect(
			f.caller().browserCaptureV1({ workspaceId: "owned", paneId: "page" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(
			f
				.caller({ isAuthenticated: false })
				.browserCaptureV1({ workspaceId: "owned", paneId: "page" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			f.caller().browserCaptureV1({ paneId: "page" } as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			f
				.caller()
				.browserCaptureV1({
					workspaceId: "owned",
					paneId: "page",
					code: "unsafe",
				} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(f.operations).toEqual([]);
	} finally {
		f.bridge.dispose();
	}
});

test("a disconnected screenshot query maps to an explicit precondition failure", async () => {
	const f = fixture();
	try {
		f.ready(["readV1", "capturePngV1"]);
		f.hold();
		const pending = f
			.caller()
			.browserCaptureV1({ workspaceId: "owned", paneId: "page" })
			.catch((error) => error);
		await f.requested.promise;
		f.peer.close();
		expect(await pending).toMatchObject({ code: "PRECONDITION_FAILED" });
	} finally {
		f.bridge.dispose();
	}
});
