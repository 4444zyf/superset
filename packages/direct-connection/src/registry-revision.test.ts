import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { ConnectionRegistry } from "./registry";

test("only a change of SSH target increments its local revision", () => {
	const registry = new ConnectionRegistry(new Database(":memory:"));
	try {
		registry.save({ id: "mac", name: "Original", host: "mini" });
		expect(registry.getTargetRevision("mac")).toBe(1);
		registry.save({
			id: "mac",
			name: "Renamed",
			host: "mini",
			backendId: "5b2ea852-8428-4a22-91e6-980f81432131",
			namespaceId: "18817038-3f91-4c8c-99e5-7267c6398f0a",
			serviceUid: 501,
		});
		expect(registry.getTargetRevision("mac")).toBe(1);
		registry.save({ id: "mac", name: "Renamed", host: "different" });
		expect(registry.getTargetRevision("mac")).toBe(2);
		expect(registry.get("mac")?.backendId).toBeUndefined();
		registry.remove("mac");
		expect(registry.getTargetRevision("mac")).toBeNull();
	} finally {
		registry.close();
	}
});
