import { expect, test } from "bun:test";
import { describeDirectBackend } from "./direct";

test("direct hosts advertise port discovery independently of terminal restore", () => {
	const identity = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		serviceUid: 1000,
	};
	const description = describeDirectBackend(identity);
	expect(description.capabilities.workstationPortsV1).toBe(true);
	expect(description.capabilities.workspaceViewRestoreV1).toBe(false);
	expect(description.cloudAccountRequired).toBe(false);
	expect(description.backendId).toBe(identity.backendId);
});
