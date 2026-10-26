import { expect, test } from "bun:test";
import { describeDirectBackend } from "./direct";
import { registerDirectAgentHookPort } from "../../../direct/agent-hook-url";

test("agent hook readiness is advertised only after this direct listener has registered its port", () => {
	const identity = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		serviceUid: 1000,
	};
	expect(
		describeDirectBackend(identity, true, true).capabilities
			.workstationAgentHooksV1,
	).toBe(false);
	const release = registerDirectAgentHookPort(43123, "a".repeat(64));
	try {
		expect(
			describeDirectBackend(identity, true, true).capabilities
				.workstationAgentHooksV1,
		).toBe(true);
		expect(
			describeDirectBackend(identity, false, true).capabilities
				.workstationAgentHooksV1,
		).toBe(false);
	} finally {
		release();
	}
	expect(
		describeDirectBackend(identity, true, true).capabilities
			.workstationAgentHooksV1,
	).toBe(false);
});

test("agent feedback requires durable operations and existing-terminal restore support", () => {
	const identity = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		serviceUid: 1000,
	};
	expect(
		describeDirectBackend(identity).capabilities.workstationAgentFeedbackV1,
	).toBe(false);
	expect(
		describeDirectBackend(identity, true, false).capabilities
			.workstationAgentFeedbackV1,
	).toBe(false);
	expect(
		describeDirectBackend(identity, false, true).capabilities
			.workstationAgentFeedbackV1,
	).toBe(false);
	expect(
		describeDirectBackend(identity, true, true).capabilities
			.workstationAgentFeedbackV1,
	).toBe(true);
});

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
