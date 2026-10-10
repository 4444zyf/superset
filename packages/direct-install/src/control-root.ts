// biome-ignore lint/style/noRestrictedImports: The privileged installer is a dedicated process.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ControlMetadata, UserControlCommand } from "./control-actions";
import {
	releaseRootFor,
	SYSTEM_ROOT,
	validateServiceConfig,
} from "./control-runtime";
import { acquireInstallerLock } from "./installer-lock";
import { createLaunchDaemonPlist } from "./launchd";
import type {
	ControlRequest,
	LifecycleAction,
	LifecycleResult,
} from "./lifecycle";
import {
	hasControlCharacters,
	type TrustedReleaseKeys,
	verifyReleaseBundle,
} from "./release";
import { reclaimUnusedRuntimes, retainUserRuntimes } from "./runtime-retention";

export interface RootLifecycleDriver {
	user(command: UserControlCommand): Promise<unknown>;
	startJob(): void;
	stopJob(): void;
	removeJob(): void;
	repairJob?: () => void;
}
export async function runLifecycle(
	action: LifecycleAction,
	driver: RootLifecycleDriver,
): Promise<LifecycleResult> {
	if (action === "activate")
		return (await driver.user("activate")) as LifecycleResult;
	if (action === "repair") {
		if (!driver.repairJob)
			throw new Error("Repair implementation is unavailable");
		await driver.user("verify-stopped");
		driver.stopJob();
		await driver.user("stop-owned");
		driver.repairJob();
		return {
			action,
			status: "completed",
			detail:
				"The signed stable launcher was updated; the backend remains explicitly stopped",
		};
	}
	if (action === "start") {
		await driver.user("start");
		driver.startJob();
	} else {
		await driver.user("stop");
		driver.stopJob();
		await driver.user("stop-owned");
		if (action === "uninstall") driver.removeJob();
	}
	return {
		action,
		status: "completed",
		detail:
			action === "uninstall"
				? "The launchd job was removed; user data and shared releases were retained"
				: undefined,
	};
}
function assertRootPath(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)
		throw new Error(
			"Lifecycle code and jobs must be root-owned and immutable to ordinary users",
		);
}
function assertRootTree(path: string): void {
	assertRootPath(path);
	if (lstatSync(path).isDirectory())
		for (const entry of readdirSync(path)) assertRootTree(join(path, entry));
}
function verifyImmutable(
	root: string,
	keys: TrustedReleaseKeys,
): ReturnType<typeof verifyReleaseBundle> {
	if (
		!new RegExp(
			`^${SYSTEM_ROOT}/runtime/[A-Za-z0-9][A-Za-z0-9._-]{0,63}-[a-f0-9]{24}$`,
		).test(root)
	)
		throw new Error("Invalid immutable lifecycle release");
	for (const parent of [SYSTEM_ROOT, join(SYSTEM_ROOT, "runtime")])
		assertRootPath(parent);
	assertRootTree(root);
	const verified = verifyReleaseBundle(root, keys);
	if (join(SYSTEM_ROOT, "runtime", verified.releaseId) !== root)
		throw new Error("Lifecycle release identity changed");
	return verified;
}
function validateControlRequest(request: ControlRequest): number {
	if (process.platform !== "darwin" || process.getuid?.() !== 0)
		throw new Error("Lifecycle registration requires a macOS administrator");
	const p = request.probe;
	if (
		!p ||
		!Number.isSafeInteger(p.uid) ||
		p.uid < 1 ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(p.username) ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(p.groupname) ||
		!p.userHome.startsWith("/") ||
		hasControlCharacters(p.userHome) ||
		!["activate", "start", "stop", "uninstall", "repair"].includes(
			request.action,
		)
	)
		throw new Error("Invalid lifecycle request");
	const uid = Number(
		execFileSync("/usr/bin/id", ["-u", p.username], {
			encoding: "utf8",
		}).trim(),
	);
	const group = execFileSync("/usr/bin/id", ["-gn", p.username], {
		encoding: "utf8",
	}).trim();
	const home = execFileSync(
		"/usr/bin/dscl",
		[".", "-read", `/Users/${p.username}`, "NFSHomeDirectory"],
		{ encoding: "utf8" },
	)
		.trim()
		.replace(/^NFSHomeDirectory:\s*/, "");
	const arch = execFileSync("/usr/bin/uname", ["-m"], {
		encoding: "utf8",
	}).trim();
	if (
		uid !== p.uid ||
		group !== p.groupname ||
		home !== p.userHome ||
		(arch === "arm64" ? "darwin-arm64" : "darwin-x64") !== p.target
	)
		throw new Error("The SSH account identity changed");
	return Number(
		execFileSync("/usr/bin/id", ["-g", p.username], {
			encoding: "utf8",
		}).trim(),
	);
}
export async function controlAsRoot(
	request: ControlRequest,
): Promise<LifecycleResult> {
	const gid = validateControlRequest(request);
	if (
		verifyImmutable(request.releaseRoot, request.trustedKeys).manifest
			.target !== request.probe.target
	)
		throw new Error("Lifecycle control architecture mismatch");
	const release = acquireInstallerLock(join(SYSTEM_ROOT, "install.lock"));
	try {
		let candidateRoot: string | undefined;
		const user = async (command: UserControlCommand): Promise<unknown> =>
			JSON.parse(
				execFileSync(
					join(request.releaseRoot, "lib/node"),
					[
						join(request.releaseRoot, "lib/direct-installer.js"),
						"--control-user",
						Buffer.from(
							JSON.stringify({ request, command, candidateRoot }),
						).toString("base64"),
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
						timeout: 30000,
						killSignal: "SIGKILL",
					},
				).trim(),
			);
		const metadata = (await user("metadata")) as ControlMetadata;
		validateServiceConfig(
			metadata.config,
			join(request.probe.userHome, ".superset-direct"),
		);
		const currentRoot = releaseRootFor(metadata.config);
		if (request.action === "repair" && !metadata.disabled)
			return {
				action: "repair",
				status: "deferred",
				detail:
					"Stop the backend explicitly before repairing its stable launcher",
			};
		if (
			verifyImmutable(currentRoot, request.trustedKeys).manifest.target !==
			request.probe.target
		)
			throw new Error("Current runtime architecture mismatch");
		if (request.action === "activate") {
			candidateRoot = metadata.stagedReleaseRoot;
			if (!candidateRoot)
				return {
					action: "activate",
					status: "deferred",
					detail: "No verified staged release is available",
				};
			if (
				verifyImmutable(candidateRoot, request.trustedKeys).manifest.target !==
				request.probe.target
			)
				return {
					action: "activate",
					status: "deferred",
					detail: "The staged release targets another architecture",
				};
		}
		const configPath = join(
			request.probe.userHome,
			".superset-direct/service-config.json",
		);
		const plistPath = `/Library/LaunchDaemons/io.superset.direct.backend.${request.probe.uid}.plist`;
		const job = `system/io.superset.direct.backend.${request.probe.uid}`;
		let plist = createLaunchDaemonPlist({
			...request.probe,
			releaseRoot: currentRoot,
			configPath,
		});
		if (existsSync(plistPath)) {
			assertRootPath(plistPath);
			const existing = readFileSync(plistPath, "utf8");
			const match =
				/<key>ProgramArguments<\/key><array><string>(.*?)\/lib\/node<\/string>/.exec(
					existing,
				);
			if (!match?.[1])
				throw new Error("The registered job has an unexpected launcher");
			verifyImmutable(match[1], request.trustedKeys);
			plist = createLaunchDaemonPlist({
				...request.probe,
				releaseRoot: match[1],
				configPath,
			});
			if (existing !== plist)
				throw new Error(
					"The existing launchd job differs from the authorized backend",
				);
		}
		retainUserRuntimes(
			request.probe.uid,
			metadata.retainedReleaseRoots.map((root) => {
				verifyImmutable(root, request.trustedKeys);
				return root.slice(`${SYSTEM_ROOT}/runtime/`.length);
			}),
		);
		const loaded = (): boolean => {
			try {
				execFileSync("/bin/launchctl", ["print", job], {
					stdio: ["ignore", "pipe", "pipe"],
				});
				return true;
			} catch {
				return false;
			}
		};
		if (!existsSync(plistPath) && loaded())
			throw new Error(
				"An unrecognized launchd job already owns this service label",
			);
		const result = await runLifecycle(request.action, {
			user,
			startJob: () => {
				if (!existsSync(plistPath))
					writeFileSync(plistPath, plist, { flag: "wx", mode: 0o644 });
				if (!loaded())
					execFileSync("/bin/launchctl", ["bootstrap", "system", plistPath], {
						stdio: ["ignore", "pipe", "pipe"],
					});
				else
					execFileSync("/bin/launchctl", ["kickstart", job], {
						stdio: ["ignore", "pipe", "pipe"],
					});
			},
			stopJob: () => {
				if (loaded())
					execFileSync("/bin/launchctl", ["bootout", job], {
						stdio: ["ignore", "pipe", "pipe"],
					});
			},
			removeJob: () => {
				rmSync(plistPath, { force: true });
			},
			repairJob: () => {
				const temporary = `${plistPath}.${randomUUID()}.partial`;
				const fd = openSync(temporary, "wx", 0o644);
				try {
					writeFileSync(
						fd,
						createLaunchDaemonPlist({
							...request.probe,
							releaseRoot: currentRoot,
							configPath,
						}),
					);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				renameSync(temporary, plistPath);
				const directory = openSync("/Library/LaunchDaemons", "r");
				try {
					fsyncSync(directory);
				} finally {
					closeSync(directory);
				}
			},
		});
		try {
			reclaimUnusedRuntimes();
		} catch {
			process.stderr.write("Unused runtime cache reclamation was skipped\n");
		}
		return result;
	} finally {
		release();
	}
}
