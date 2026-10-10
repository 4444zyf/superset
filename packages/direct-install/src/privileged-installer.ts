// biome-ignore lint/style/noRestrictedImports: This installer is a dedicated process, never a serving event loop.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { assertReleaseCapacity, parseDiskFreeBytes } from "./capacity";
import {
	controlAsUser,
	type UserControlCommand,
	userRetainedReleaseRoots,
} from "./control-actions";
import { controlAsRoot } from "./control-root";
import { backendRequest, readServiceConfig } from "./control-runtime";
import type { InstallResult, RemoteBackendProbe } from "./install";
import { acquireInstallerLock } from "./installer-lock";
import { createLaunchDaemonPlist } from "./launchd";
import type { ControlRequest } from "./lifecycle";
import { runNativeSmoke } from "./native-smoke";
import {
	hasControlCharacters,
	type TrustedReleaseKeys,
	verifyReleaseBundle,
	verifyReleaseManifest,
} from "./release";
import { reclaimUnusedRuntimes, retainUserRuntimes } from "./runtime-retention";

const SYSTEM_ROOT = "/Library/Application Support/SupersetDirect";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const atomicJson = (path: string, value: unknown) => {
	const temporary = `${path}.${randomUUID()}.partial`;
	writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
	renameSync(temporary, path);
};

export { acquireInstallerLock } from "./installer-lock";

export interface PrepareUserOptions {
	userHome: string;
	releaseRoot: string;
	releaseId: string;
	allowedOrigins: string[];
	installId?: string;
}
export function prepareUserInstallation(
	options: PrepareUserOptions,
): InstallResult {
	const homeDir = join(options.userHome, ".superset-direct");
	for (const directory of [
		homeDir,
		join(homeDir, "credentials"),
		join(homeDir, "state"),
		join(homeDir, "logs"),
		join(homeDir, "host"),
		join(homeDir, "sessions"),
	]) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		if (lstatSync(directory).isSymbolicLink())
			throw new Error(
				"The direct backend data directory must not be a symlink",
			);
		chmodSync(directory, 0o700);
	}
	const releaseLock = acquireInstallerLock(join(homeDir, "state/install.lock"));
	try {
		for (const name of ["service.log", "service-error.log"]) {
			const path = join(homeDir, "logs", name);
			if (!existsSync(path))
				writeFileSync(path, "", { flag: "wx", mode: 0o600 });
		}
		const identityPath = join(homeDir, "identity.json");
		let identity: InstallResult["identity"];
		if (existsSync(identityPath)) {
			identity = JSON.parse(readFileSync(identityPath, "utf8"));
			if (
				!UUID.test(identity.backendId) ||
				!UUID.test(identity.namespaceId) ||
				identity.homeDir !== homeDir
			)
				throw new Error("Invalid installed backend identity");
		} else {
			identity = {
				backendId: randomUUID(),
				namespaceId: randomUUID(),
				homeDir,
			};
			atomicJson(identityPath, identity);
		}
		const secretFile = join(homeDir, "credentials/host-secret");
		if (!existsSync(secretFile))
			writeFileSync(secretFile, randomBytes(32).toString("hex"), {
				mode: 0o600,
				flag: "wx",
			});
		if (
			lstatSync(secretFile).isSymbolicLink() ||
			!/^[a-f0-9]{64}$/.test(readFileSync(secretFile, "utf8").trim())
		)
			throw new Error("Invalid installed backend secret");
		chmodSync(secretFile, 0o600);
		const configPath = join(homeDir, "service-config.json");
		let status: InstallResult["status"] = "installed";
		if (existsSync(configPath)) {
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			if (
				config.backendId !== identity.backendId ||
				config.namespaceId !== identity.namespaceId ||
				config.homeDir !== homeDir
			)
				throw new Error("Installed service config does not match its identity");
			status =
				config.hostServicePath ===
				join(options.releaseRoot, "lib/host-service-direct.js")
					? "already-installed"
					: "staged";
		} else
			atomicJson(configPath, {
				...identity,
				installationMode: "managed",
				secretFile,
				migrationsFolder: join(options.releaseRoot, "share/migrations"),
				chatMigrationsFolder: join(options.releaseRoot, "lib/chat-migrations"),
				allowedOrigins: options.allowedOrigins,
				hostServicePath: join(
					options.releaseRoot,
					"lib/host-service-direct.js",
				),
			});
		atomicJson(join(homeDir, "state/install-journal.json"), {
			installId: options.installId,
			releaseId: options.releaseId,
			phase: status === "staged" ? "staged" : "registered",
			previousServicePreserved: status !== "installed",
		});
		if (status === "staged")
			atomicJson(join(homeDir, "state/staged-release.json"), {
				releaseId: options.releaseId,
				releaseRoot: options.releaseRoot,
				activation: "deferred",
			});
		return { identity, releaseId: options.releaseId, status };
	} finally {
		releaseLock();
	}
}

interface InstallerRequest {
	probe: RemoteBackendProbe;
	trustedKeys: TrustedReleaseKeys;
	allowedOrigins: string[];
	installId: string;
	expectedReleaseId: string;
	incoming: string;
	manifestBase64: string;
	signatureBase64: string;
}
function validateRequest(request: InstallerRequest): void {
	const p = request.probe;
	if (
		!p ||
		!Number.isSafeInteger(p.uid) ||
		p.uid <= 0 ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(p.username) ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(p.groupname) ||
		!p.userHome.startsWith("/") ||
		hasControlCharacters(p.userHome) ||
		!UUID.test(request.installId) ||
		request.incoming !==
			join(
				p.userHome,
				".superset-direct/incoming",
				`${request.installId}.partial`,
			) ||
		!Array.isArray(request.allowedOrigins) ||
		request.allowedOrigins.length > 64 ||
		request.allowedOrigins.some(
			(origin) =>
				typeof origin !== "string" ||
				hasControlCharacters(origin) ||
				origin.length > 2048,
		)
	)
		throw new Error("Invalid installation request");
	if (
		Number(
			execFileSync("/usr/bin/id", ["-u", p.username], {
				encoding: "utf8",
			}).trim(),
		) !== p.uid
	)
		throw new Error("The SSH user identity changed");
	const home = execFileSync(
		"/usr/bin/dscl",
		[".", "-read", `/Users/${p.username}`, "NFSHomeDirectory"],
		{ encoding: "utf8" },
	)
		.trim()
		.replace(/^NFSHomeDirectory:\s*/, "");
	if (home !== p.userHome)
		throw new Error("The remote home does not match the OS account");
	if (
		execFileSync("/usr/bin/id", ["-gn", p.username], {
			encoding: "utf8",
		}).trim() !== p.groupname
	)
		throw new Error("The SSH user's effective group changed");
	const target =
		execFileSync("/usr/bin/uname", ["-m"], { encoding: "utf8" }).trim() ===
		"arm64"
			? "darwin-arm64"
			: "darwin-x64";
	if (p.target !== target) throw new Error("The remote architecture changed");
}

function rootDirectory(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o755 });
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== 0 ||
		(stat.mode & 0o022) !== 0
	)
		throw new Error(
			"Installation directories must be root-owned and not writable by other users",
		);
}
function makeRuntimeReadable(path: string): void {
	chmodSync(path, 0o755);
	for (const entry of readdirSync(path, { withFileTypes: true }))
		if (entry.isDirectory()) makeRuntimeReadable(join(path, entry.name));
}
function userCommand(
	releaseRoot: string,
	request: InstallerRequest,
	flag: string,
	extra?: unknown,
): string {
	const gid = Number(
		execFileSync("/usr/bin/id", ["-g", request.probe.username], {
			encoding: "utf8",
		}).trim(),
	);
	return execFileSync(
		join(releaseRoot, "lib/node"),
		[
			join(releaseRoot, "lib/direct-installer.js"),
			flag,
			Buffer.from(JSON.stringify({ request, releaseRoot, extra })).toString(
				"base64",
			),
		],
		{
			uid: request.probe.uid,
			gid,
			encoding: "utf8",
			env: {
				HOME: request.probe.userHome,
				PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
			},
			maxBuffer: 1024 * 1024,
		},
	).trim();
}

async function authenticatedHealth(
	result: InstallResult,
	uid: number,
): Promise<void> {
	const home = result.identity.homeDir;
	if (process.getuid?.() !== uid || uid === 0)
		throw new Error("Backend health must run as the unprivileged service user");
	const config = readServiceConfig(join(home, "service-config.json"));
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			const description = await backendRequest<{
				backendId: string;
				namespaceId: string;
				serviceUid: number;
				runtimeMode: string;
			}>(config, "describe");
			if (
				description.backendId !== result.identity.backendId ||
				description.namespaceId !== result.identity.namespaceId ||
				description.serviceUid !== uid ||
				description.runtimeMode !== "direct"
			)
				throw new Error("Endpoint identity mismatch");
			return;
		} catch {
			if (attempt === 39)
				throw new Error("The registered backend did not become healthy");
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
}

async function installAsRoot(
	payload: string,
	request: InstallerRequest,
): Promise<InstallResult> {
	if (process.platform !== "darwin" || process.getuid?.() !== 0)
		throw new Error("System installation requires a macOS administrator");
	validateRequest(request);
	const verified = verifyReleaseManifest(
		Buffer.from(request.manifestBase64, "base64"),
		Buffer.from(request.signatureBase64, "base64"),
		request.trustedKeys,
	);
	if (
		verified.releaseId !== request.expectedReleaseId ||
		verified.manifest.target !== request.probe.target
	)
		throw new Error("The staged release differs from the authorized release");
	assertReleaseCapacity(
		verified.manifest.files.reduce(
			(sum, file) => sum + file.size,
			verified.manifestBytes.length + verified.signatureBytes.length,
		),
		parseDiskFreeBytes(
			execFileSync("/bin/df", ["-Pk", "/Library"], {
				encoding: "utf8",
				env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
			}),
		),
		2,
	);
	rootDirectory(SYSTEM_ROOT);
	rootDirectory(join(SYSTEM_ROOT, "runtime"));
	const releaseGlobalLock = acquireInstallerLock(
		join(SYSTEM_ROOT, "install.lock"),
	);
	const releaseRoot = join(SYSTEM_ROOT, "runtime", verified.releaseId);
	let stagingPath: string | undefined;
	try {
		const gid = Number(
			execFileSync("/usr/bin/id", ["-g", request.probe.username], {
				encoding: "utf8",
			}).trim(),
		);
		for (const file of verified.manifest.files) {
			if (["lib/node", "lib/direct-installer.js"].includes(file.path)) continue;
			if (file.size > 256 * 1024 * 1024)
				throw new Error("A release file exceeds the installation size limit");
			const bytes = execFileSync(
				"/usr/bin/head",
				["-c", String(file.size + 1), join(request.incoming, file.path)],
				{
					uid: request.probe.uid,
					gid,
					maxBuffer: file.size + 2,
					env: { HOME: request.probe.userHome, PATH: "/usr/bin:/bin" },
				},
			);
			mkdirSync(join(payload, file.path, ".."), {
				recursive: true,
				mode: 0o755,
			});
			writeFileSync(join(payload, file.path), bytes, {
				mode: file.mode,
				flag: "wx",
			});
		}
		writeFileSync(
			join(payload, "release-manifest.json"),
			verified.manifestBytes,
			{ mode: 0o644, flag: "wx" },
		);
		writeFileSync(
			join(payload, "release-signature.json"),
			verified.signatureBytes,
			{ mode: 0o644, flag: "wx" },
		);
		verifyReleaseBundle(payload, request.trustedKeys);
		if (!existsSync(releaseRoot)) {
			const staged = `${releaseRoot}.${request.installId}.partial`;
			stagingPath = staged;
			rmSync(staged, { recursive: true, force: true });
			cpSync(payload, staged, { recursive: true });
			verifyReleaseBundle(staged, request.trustedKeys);
			makeRuntimeReadable(staged);
			for (const file of verified.manifest.files)
				chmodSync(join(staged, file.path), file.mode === 0o755 ? 0o555 : 0o444);
			for (const metadata of [
				"release-manifest.json",
				"release-signature.json",
			])
				chmodSync(join(staged, metadata), 0o444);
			renameSync(staged, releaseRoot);
			stagingPath = undefined;
		} else {
			rootDirectory(releaseRoot);
			verifyReleaseBundle(releaseRoot, request.trustedKeys);
		}
		const result = JSON.parse(
			userCommand(releaseRoot, request, "--prepare-user"),
		) as InstallResult;
		const retained = JSON.parse(
			userCommand(releaseRoot, request, "--retention-user"),
		) as string[];
		retainUserRuntimes(
			request.probe.uid,
			retained.map((root) => {
				if (!root.startsWith(`${SYSTEM_ROOT}/runtime/`))
					throw new Error("Invalid retained runtime path");
				return root.slice(`${SYSTEM_ROOT}/runtime/`.length);
			}),
		);
		try {
			reclaimUnusedRuntimes({ activeInstallId: request.installId });
		} catch {
			process.stderr.write("Unused runtime cache reclamation was skipped\n");
		}
		userCommand(releaseRoot, request, "--smoke-user");
		if (result.status === "staged") return result;
		if (
			(
				JSON.parse(userCommand(releaseRoot, request, "--disabled-user")) as {
					disabled: boolean;
				}
			).disabled
		)
			throw new Error(
				"The backend is explicitly stopped; use Start backend to enable it",
			);
		const plistPath = `/Library/LaunchDaemons/io.superset.direct.backend.${request.probe.uid}.plist`;
		const plist = createLaunchDaemonPlist({
			...request.probe,
			releaseRoot,
			configPath: join(result.identity.homeDir, "service-config.json"),
		});
		if (!existsSync(plistPath)) {
			writeFileSync(plistPath, plist, { mode: 0o644, flag: "wx" });
			try {
				execFileSync("/bin/launchctl", ["bootstrap", "system", plistPath], {
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch (error) {
				rmSync(plistPath, { force: true });
				throw error;
			}
		} else if (
			lstatSync(plistPath).isSymbolicLink() ||
			lstatSync(plistPath).uid !== 0 ||
			readFileSync(plistPath, "utf8") !== plist
		)
			throw new Error(
				"The existing job differs from the authorized backend; explicit repair is required",
			);
		userCommand(releaseRoot, request, "--health-user", result);
		userCommand(releaseRoot, request, "--journal-user", {
			phase: "committed",
			releaseId: result.releaseId,
			installId: request.installId,
		});
		return result;
	} catch (error) {
		try {
			userCommand(releaseRoot, request, "--journal-user", {
				phase: "failed",
				installId: request.installId,
				releaseId: request.expectedReleaseId,
				error: error instanceof Error ? error.message : "Installation failed",
			});
		} catch {}
		throw error;
	} finally {
		if (stagingPath) rmSync(stagingPath, { recursive: true, force: true });
		releaseGlobalLock();
	}
}

async function main(): Promise<void> {
	const flag = process.argv[2];
	const argument = process.argv[3];
	if (!argument) throw new Error("Missing installer argument");
	if (flag === "--control") {
		const request = JSON.parse(
			Buffer.from(argument, "base64").toString("utf8"),
		) as ControlRequest;
		const result = await controlAsRoot(request);
		process.stdout.write(`SUPERSET_DIRECT_CONTROL=${JSON.stringify(result)}\n`);
	} else if (flag === "--control-user") {
		const input = JSON.parse(
			Buffer.from(argument, "base64").toString("utf8"),
		) as {
			request: ControlRequest;
			command: UserControlCommand;
			candidateRoot?: string;
		};
		process.stdout.write(
			JSON.stringify(
				await controlAsUser(input.request, input.command, input.candidateRoot),
			),
		);
	} else if (flag === "--install") {
		const encoded = process.argv[4];
		if (!encoded) throw new Error("Missing installation request");
		const request = JSON.parse(
			readFileSync(encoded, "utf8"),
		) as InstallerRequest;
		const result = await installAsRoot(argument, request);
		process.stdout.write(`SUPERSET_DIRECT_INSTALL=${JSON.stringify(result)}\n`);
	} else {
		const input = JSON.parse(
			Buffer.from(argument, "base64").toString("utf8"),
		) as { request: InstallerRequest; releaseRoot: string; extra: unknown };
		if (
			flag !== "--smoke-user" &&
			(process.getuid?.() !== input.request.probe.uid ||
				process.getuid?.() === 0)
		)
			throw new Error(
				"Installer user operations require the ordinary service UID",
			);
		if (flag === "--prepare-user")
			process.stdout.write(
				JSON.stringify(
					prepareUserInstallation({
						userHome: input.request.probe.userHome,
						releaseRoot: input.releaseRoot,
						releaseId: input.request.expectedReleaseId,
						allowedOrigins: input.request.allowedOrigins,
						installId: input.request.installId,
					}),
				),
			);
		else if (flag === "--journal-user")
			atomicJson(
				join(
					input.request.probe.userHome,
					".superset-direct/state/install-journal.json",
				),
				input.extra,
			);
		else if (flag === "--health-user")
			await authenticatedHealth(
				input.extra as InstallResult,
				input.request.probe.uid,
			);
		else if (flag === "--retention-user")
			process.stdout.write(
				JSON.stringify(
					userRetainedReleaseRoots(
						readServiceConfig(
							join(
								input.request.probe.userHome,
								".superset-direct/service-config.json",
							),
						),
					),
				),
			);
		else if (flag === "--disabled-user")
			process.stdout.write(
				JSON.stringify({
					disabled: existsSync(
						join(
							input.request.probe.userHome,
							".superset-direct/state/disabled",
						),
					),
				}),
			);
		else if (flag === "--smoke-user") await runNativeSmoke();
	}
}
if (
	[
		"--install",
		"--prepare-user",
		"--journal-user",
		"--health-user",
		"--smoke-user",
		"--disabled-user",
		"--control",
		"--control-user",
		"--retention-user",
	].includes(process.argv[2] ?? "")
)
	main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : "Installation failed"}\n`,
		);
		process.exitCode = 1;
	});
