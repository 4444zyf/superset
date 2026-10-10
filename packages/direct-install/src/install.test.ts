import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
	buildPrivilegedBootstrap,
	installRemoteBackend,
	probeRemoteBackend,
} from "./install";
import { createSignedReleaseFixture } from "./release-fixture";

test("probes a fresh Mac without requiring a remote language runtime", async () => {
	let command = "";
	const probe = await probeRemoteBackend({
		exec: async (cmd) => {
			command = cmd;
			return {
				stdout: [
					"Darwin",
					"arm64",
					"501",
					"alice",
					"staff",
					"/Users/alice",
					"14.5",
					"",
				].join("\0"),
				stderr: "",
				exitCode: 0,
			};
		},
		upload: async () => {},
	});
	expect(probe.target).toBe("darwin-arm64");
	expect(probe.uid).toBe(501);
	expect(command).not.toMatch(/python|jq|bun|node/);
});
test("failed uploads and rejected authorization reclaim only their own private incoming directory", async () => {
	const release = createSignedReleaseFixture();
	try {
		for (const failure of ["upload", "sudo"]) {
			const commands: string[] = [];
			const uploaded: string[] = [];
			await expect(
				installRemoteBackend({
					releaseRoot: release.root,
					trustedKeys: release.keys,
					transport: {
						exec: async (cmd) => {
							commands.push(cmd);
							if (cmd.includes("uname"))
								return {
									stdout: [
										"Darwin",
										"arm64",
										"501",
										"alice",
										"staff",
										"/Users/alice",
										"14.5",
										"",
									].join("\0"),
									stderr: "",
									exitCode: 0,
								};
							if (cmd.includes("sudo"))
								return {
									stdout: "",
									stderr: "sudo: password required",
									exitCode: 1,
								};
							if (cmd.includes("df -Pk"))
								return {
									stdout:
										"Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 1000000000 1 999999999 1% /\n",
									stderr: "",
									exitCode: 0,
								};
							return { stdout: "", stderr: "", exitCode: 0 };
						},
						upload: async (_local, remote) => {
							uploaded.push(remote);
							if (failure === "upload") throw new Error("upload failed");
						},
					},
				}),
			).rejects.toThrow(
				failure === "upload" ? "upload failed" : "authorization",
			);
			const incoming = `${uploaded[0]?.split(".partial/")[0]}.partial`;
			expect(commands.at(-1)).toBe(`/bin/rm -rf '${incoming}'`);
			expect(commands.filter((cmd) => cmd.includes("rm -rf"))).toHaveLength(1);
		}
	} finally {
		rmSync(release.root, { recursive: true, force: true });
	}
});
test("incoming cache admission rejects another upload before creating directories or sending payload bytes", async () => {
	const release = createSignedReleaseFixture();
	let uploads = 0;
	const commands: string[] = [];
	try {
		await expect(
			installRemoteBackend({
				releaseRoot: release.root,
				trustedKeys: release.keys,
				transport: {
					async exec(command) {
						commands.push(command);
						if (command.includes("uname"))
							return {
								stdout: [
									"Darwin",
									"arm64",
									"501",
									"alice",
									"staff",
									"/Users/alice",
									"14.5",
									"",
								].join("\0"),
								stderr: "",
								exitCode: 0,
							};
						if (command.includes("df -Pk"))
							return {
								stdout:
									"Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 1000000000 1 999999999 1% /\n",
								stderr: "",
								exitCode: 0,
							};
						if (command === "/bin/sh -s")
							return {
								stdout: "",
								stderr: "incoming cache budget exhausted",
								exitCode: 66,
							};
						return { stdout: "", stderr: "", exitCode: 0 };
					},
					async upload() {
						uploads++;
						throw new Error("Payload sent without cache admission");
					},
				},
			}),
		).rejects.toThrow("upload cache");
		expect(uploads).toBe(0);
		expect(
			commands.some(
				(command) =>
					command.includes("mkdir") ||
					command.includes("sudo") ||
					command.includes("rm -rf"),
			),
		).toBe(false);
	} finally {
		rmSync(release.root, { recursive: true, force: true });
	}
});
test("rejects privileged or unsupported SSH identities", async () => {
	const transport = {
		exec: async () => ({
			stdout: [
				"Darwin",
				"arm64",
				"0",
				"root",
				"wheel",
				"/var/root",
				"14.5",
				"",
			].join("\0"),
			stderr: "",
			exitCode: 0,
		}),
		upload: async () => {},
	};
	await expect(probeRemoteBackend(transport)).rejects.toThrow("root");
});
test("bootstrap copies into root-private storage and verifies Node before executing it", () => {
	const script = buildPrivilegedBootstrap({
		incoming: "/Users/alice/.superset-direct/incoming/install-123",
		uid: 501,
		nodeSize: 100,
		installerSize: 200,
		nodeDigest: "a".repeat(64),
		installerDigest: "b".repeat(64),
		requestBase64: Buffer.from("{}").toString("base64"),
	});
	expect(script).toContain("/usr/bin/shasum -a 256");
	expect(script.indexOf("nodeDigest=")).toBeLessThan(
		script.indexOf('"$payload/lib/node" "$payload/lib/direct-installer.js"'),
	);
	expect(script).toContain("/usr/bin/mktemp -d /private/tmp/superset-direct.");
	expect(script).not.toContain("/bin/cp");
	expect(script).toContain("/usr/bin/head -c 101");
	expect(script).toContain("/usr/bin/sudo -n -u '#501'");
	expect(script).not.toContain("nohup");
});
