import { afterEach, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireInstallerLock,
	prepareUserInstallation,
	userInstallerInput,
} from "./privileged-installer";

const roots: string[] = [];

test("user-only helpers receive identity and operation data without the large signed release buffers", () => {
	const serialized = userInstallerInput(
		{
			probe: { uid: 501, userHome: "/Users/alice" },
			installId: "install",
			expectedReleaseId: "release",
			manifestBase64: "m".repeat(2_000_000),
			signatureBase64: "signature",
		},
		"/runtime",
		{ phase: "committed" },
	);
	expect(Buffer.byteLength(serialized)).toBeLessThan(4096);
	expect(JSON.parse(serialized)).toMatchObject({
		request: { probe: { uid: 501 }, expectedReleaseId: "release" },
		releaseRoot: "/runtime",
		extra: { phase: "committed" },
	});
});
const temporary = () => {
	const root = mkdtempSync(join(tmpdir(), "direct-install-"));
	roots.push(root);
	return root;
};
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
test.skipIf(!process.getuid?.())(
	"the unprivileged installer reads a large request from stdin",
	async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dirname, "privileged-installer.ts"),
				"--disabled-user",
				"-",
			],
			{
				stdin: new Blob([
					JSON.stringify({
						request: {
							probe: { uid: process.getuid?.(), userHome: temporary() },
							manifestBase64: "entry".repeat(300000),
						},
					}),
				]),
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [status, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(status).toBe(0);
		expect(JSON.parse(stdout)).toEqual({ disabled: false });
	},
);
test("serializes installation mutations and releases on completion", () => {
	const path = join(temporary(), "install.lock");
	const release = acquireInstallerLock(path);
	expect(() => acquireInstallerLock(path)).toThrow("in progress");
	release();
	expect(() => acquireInstallerLock(path)()).not.toThrow();
});
test("recovers abandoned locks, including an interrupted recovery owner", () => {
	const path = join(temporary(), "install.lock");
	for (const lock of [path, `${path}.recovery`])
		symlinkSync(
			"superset-lock-2147483647-11111111-1111-1111-1111-111111111111",
			lock,
		);
	expect(() => acquireInstallerLock(path)()).not.toThrow();
});
test("creates private stable backend identity and defers upgrades without replacing live config", () => {
	const userHome = temporary();
	const initial = prepareUserInstallation({
		userHome,
		releaseRoot: "/immutable/v1",
		releaseId: "v1",
		allowedOrigins: [],
	});
	const second = prepareUserInstallation({
		userHome,
		releaseRoot: "/immutable/v2",
		releaseId: "v2",
		allowedOrigins: [],
	});
	expect(second.identity).toEqual(initial.identity);
	expect(second.status).toBe("staged");
	const config = JSON.parse(
		readFileSync(
			join(userHome, ".superset-direct/service-config.json"),
			"utf8",
		),
	);
	expect(config.hostServicePath).toBe(
		"/immutable/v1/lib/host-service-direct.js",
	);
	expect(
		statSync(join(userHome, ".superset-direct/credentials/host-secret")).mode &
			0o777,
	).toBe(0o600);
	expect(
		readFileSync(
			join(userHome, ".superset-direct/credentials/host-secret"),
			"utf8",
		).trim().length,
	).toBe(64);
});
