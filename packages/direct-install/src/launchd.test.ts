import { expect, test } from "bun:test";
import { createLaunchDaemonPlist } from "./launchd";

test("uses system launchd but runs the immutable release as the SSH user", () => {
	const plist = createLaunchDaemonPlist({
		uid: 501,
		username: "alice",
		groupname: "staff",
		userHome: "/Users/alice",
		releaseRoot:
			"/Library/Application Support/SupersetDirect/runtime/1.0.0-abc",
		configPath: "/Users/alice/.superset-direct/service-config.json",
	});
	expect(plist).toContain("<key>UserName</key><string>alice</string>");
	expect(plist).toContain("<key>AbandonProcessGroup</key><true/>");
	expect(plist).toContain("lib/direct-supervisor.js");
	expect(plist).toContain("<key>RunAtLoad</key><true/>");
	expect(plist).not.toContain("relay");
});
test("rejects root and escapes XML values", () => {
	const input = {
		uid: 501,
		username: "alice",
		groupname: "staff",
		userHome: "/Users/A&B",
		releaseRoot: "/Library/Application Support/SupersetDirect/runtime/v1",
		configPath: "/Users/A&B/.superset-direct/service-config.json",
	};
	expect(createLaunchDaemonPlist(input)).toContain("A&amp;B");
	expect(() => createLaunchDaemonPlist({ ...input, uid: 0 })).toThrow("root");
});
