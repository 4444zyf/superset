import { expect, test } from "bun:test";
import { DirectBrowserReadBridge } from "./browser-read-bridge";
const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};
function fixture(features = ["readV1", "openV1"]) {
	const tasks = new Set<() => void>(),
		sent: Array<Record<string, unknown>> = [];
	const bridge = new DirectBrowserReadBridge(identity, {
		schedule: (_ms, cb) => {
			tasks.add(cb);
			return () => {
				tasks.delete(cb);
			};
		},
	});
	const peer = bridge.attach({
		send: (raw) => sent.push(JSON.parse(raw)),
		close: () => {},
	});
	peer.receive(
		JSON.stringify({ type: "hello", protocol: 1, ...identity, features }),
	);
	const scopeId = crypto.randomUUID();
	const availability = (scope = scopeId, ready = true, accepting = true) =>
		peer.receive(
			JSON.stringify({
				type: "open-availability",
				scopeId: scope,
				ready,
				accepting,
			}),
		);
	const input = {
		workspaceId: "owned",
		projectId: null,
		workspaceName: "Owned 工作区",
		url: "localhost:3000/中文",
		target: "current-tab" as const,
		show: false,
	};
	const result = {
		paneId: "created-pane",
		url: "http://localhost:3000/中文",
		title: "",
	};
	const request = () => {
		const p = sent.at(-1);
		if (p?.type !== "open-request") throw Error("Missing owned open");
		return p;
	};
	return {
		bridge,
		peer,
		tasks,
		sent,
		scopeId,
		availability,
		input,
		result,
		request,
	};
}

test("negotiated open support stays unavailable until its renderer scope is ready", () => {
	const f = fixture();
	try {
		expect(f.bridge.isOpenReady()).toBe(false);
		f.availability();
		expect(f.bridge.isOpenReady()).toBe(true);
		expect(f.sent).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});

test("open pinning reserves a peer and scope without sending until accepted execution", async () => {
	const f = fixture();
	try {
		f.availability();
		const execute = f.bridge.pinOpen(f.input);
		expect(f.sent).toHaveLength(1);
		expect(f.tasks.size).toBe(0);
		const pending = execute(),
			request = f.request();
		expect(request).toMatchObject({
			type: "open-request",
			scopeId: f.scopeId,
			...f.input,
		});
		f.peer.receive(
			JSON.stringify({
				type: "open-result",
				id: request.id,
				scopeId: f.scopeId,
				ok: true,
				result: f.result,
			}),
		);
		expect(await pending).toEqual(f.result);
		expect(f.tasks.size).toBe(0);
		execute.release?.();
	} finally {
		f.bridge.dispose();
	}
});

test("a same-scope busy availability update does not cancel its accepted open", async () => {
	const f = fixture();
	try {
		f.availability();
		const pending = f.bridge.pinOpen(f.input)(),
			request = f.request();
		f.availability(f.scopeId, true, false);
		expect(f.bridge.isOpenReady()).toBe(false);
		expect(() => f.bridge.pinOpen(f.input)).toThrow("unavailable");
		f.peer.receive(
			JSON.stringify({
				type: "open-result",
				id: request.id,
				scopeId: f.scopeId,
				ok: true,
				result: f.result,
			}),
		);
		expect(await pending).toEqual(f.result);
	} finally {
		f.bridge.dispose();
	}
});

test("changing only the view scope cancels open without disconnecting original reads", async () => {
	const f = fixture();
	try {
		f.availability();
		const pinned = f.bridge.pinOpen(f.input),
			pending = pinned().catch((error) => error),
			old = f.request();
		const nextScope = crypto.randomUUID();
		f.availability(nextScope);
		expect(await pending).toMatchObject({ kind: "unavailable" });
		expect(f.bridge.isReady()).toBe(true);
		expect(f.bridge.isOpenReady()).toBe(true);
		const next = f.bridge.pinOpen(f.input)(),
			latest = f.request();
		pinned.release?.();
		f.peer.receive(
			JSON.stringify({
				type: "open-result",
				id: old.id,
				scopeId: f.scopeId,
				ok: true,
				result: f.result,
			}),
		);
		f.peer.receive(
			JSON.stringify({
				type: "open-result",
				id: latest.id,
				scopeId: nextScope,
				ok: true,
				result: f.result,
			}),
		);
		expect(await next).toEqual(f.result);
	} finally {
		f.bridge.dispose();
	}
});

test("an unavailable renderer scope and unnegotiated open frames cannot produce an open", () => {
	const f = fixture();
	try {
		f.availability();
		f.availability(f.scopeId, false, false);
		expect(f.bridge.isOpenReady()).toBe(false);
		expect(() => f.bridge.pinOpen(f.input)).toThrow("unavailable");
		expect(f.bridge.isReady()).toBe(true);
	} finally {
		f.bridge.dispose();
	}
	const old = fixture(["readV1"]);
	try {
		old.availability();
		expect(old.bridge.isReady()).toBe(false);
		expect(old.sent.some((p) => p.type === "open-request")).toBe(false);
	} finally {
		old.bridge.dispose();
	}
});

test("a correct request id cannot accept a result from a different view scope", async () => {
	const f = fixture();
	try {
		f.availability();
		const pending = f.bridge.pinOpen(f.input)(),
			request = f.request();
		f.peer.receive(
			JSON.stringify({
				type: "open-result",
				id: request.id,
				scopeId: crypto.randomUUID(),
				ok: true,
				result: f.result,
			}),
		);
		expect(f.tasks.size).toBe(1);
		f.peer.receive(
			JSON.stringify({
				type: "open-result",
				id: request.id,
				scopeId: f.scopeId,
				ok: true,
				result: f.result,
			}),
		);
		expect(await pending).toEqual(f.result);
		expect(f.tasks.size).toBe(0);
	} finally {
		f.bridge.dispose();
	}
});
