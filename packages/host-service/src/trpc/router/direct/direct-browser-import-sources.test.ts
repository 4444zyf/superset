import { expect, test } from "bun:test";
import { DirectBrowserReadBridge } from "../../../direct/browser-read-bridge";
import type { HostServiceContext } from "../../../types";
import { router } from "../../index";
import { describeDirectBackend, directRouter } from "./direct";

const root = router({ direct: directRouter });
const identity = {
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	serviceUid: 1000,
};
const source = {
	id: "/owned/配置/Default",
	browserName: "Google Chrome",
	profileName: "Owned 中文",
	browserKey: "chrome",
	future: "kept",
};
function fixture(features = ["readV1", "importSourcesV1"]) {
	const calls: unknown[] = [];
	const requested = Promise.withResolvers<void>();
	let hold = false;
	const bridge = new DirectBrowserReadBridge(identity);
	const peer = bridge.attach({
		send: (raw) => {
			const packet = JSON.parse(raw);
			if (packet.type !== "import-sources-request") return;
			calls.push(packet);
			requested.resolve();
			if (!hold)
				peer.receive(
					JSON.stringify({
						type: "import-sources-result",
						id: packet.id,
						ok: true,
						result: { sources: [source] },
					}),
				);
		},
		close: () => {},
	});
	peer.receive(
		JSON.stringify({ type: "hello", protocol: 1, ...identity, features }),
	);
	const caller = (overrides: Partial<HostServiceContext> = {}) =>
		root.createCaller({
			direct: identity,
			isAuthenticated: true,
			directBrowserReads: bridge,
			...overrides,
		} as HostServiceContext).direct;
	return {
		bridge,
		peer,
		caller,
		calls,
		requested,
		hold: () => {
			hold = true;
		},
	};
}
test("the protected sources query retains original fields and needs no mutation journal", async () => {
	const f = fixture();
	try {
		expect(await f.caller().browserImportSourcesV1()).toEqual({
			sources: [source],
		});
		expect(f.calls).toHaveLength(1);
		expect(
			describeDirectBackend(identity, false, false, f.bridge).capabilities
				.workstationBrowserImportSourcesV1,
		).toBe(true);
	} finally {
		f.bridge.dispose();
	}
});
test("sources queries keep original authentication and require the direct negotiated peer", async () => {
	const f = fixture(["readV1"]);
	try {
		await expect(
			f.caller({ isAuthenticated: false }).browserImportSourcesV1(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			f.caller({ direct: undefined }).browserImportSourcesV1(),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(f.caller().browserImportSourcesV1()).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(f.calls).toEqual([]);
		expect(
			describeDirectBackend(identity, true, false, f.bridge).capabilities
				.workstationBrowserImportSourcesV1,
		).toBe(false);
	} finally {
		f.bridge.dispose();
	}
});
test("sources query cannot accept an arbitrary profile path", async () => {
	const f = fixture();
	try {
		await expect(
			f.caller().browserImportSourcesV1({ profileDir: "/foreign" } as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(f.calls).toEqual([]);
	} finally {
		f.bridge.dispose();
	}
});
test("a disconnected sources query returns the original explicit precondition error without retry", async () => {
	const f = fixture();
	try {
		f.hold();
		const result = f
			.caller()
			.browserImportSourcesV1()
			.catch((e) => e);
		await Promise.race([
			f.requested.promise,
			result.then(() => {
				throw Error("Source read settled before dispatch");
			}),
		]);
		f.peer.close();
		expect(await result).toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(f.calls).toHaveLength(1);
	} finally {
		f.bridge.dispose();
	}
});
