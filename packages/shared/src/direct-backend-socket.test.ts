import { expect, test } from "bun:test";
import { directBackendSocketPath } from "./direct-backend-socket";

test("a direct backend has a short stable socket path even with a long macOS home", () => {
	const input = {
		homeDir: `/Users/${"long-user-".repeat(12)}/Library/Application Support/Superset/local-backend`,
		backendId: "backend",
		namespaceId: "namespace",
		uid: 501,
	};
	const path = directBackendSocketPath(input);
	expect(Buffer.byteLength(path)).toBeLessThan(104);
	expect(path).toMatch(
		/^\/tmp\/superset-direct-501-[a-f0-9]{32}\/control\.sock$/,
	);
	expect(directBackendSocketPath({ ...input })).toBe(path);
	expect(
		directBackendSocketPath({ ...input, namespaceId: "another" }),
	).not.toBe(path);
});
