import { createPublicKey } from "node:crypto";
import { authorizeRemoteScript } from "./authorization";
import type {
	RemoteBackendProbe,
	RemoteCommandResult,
	RemoteTransport,
} from "./install";
import { probeRemoteBackend } from "./install";
import { type TrustedReleaseKeys, verifyReleaseManifest } from "./release";

export type LifecycleAction =
	| "activate"
	| "start"
	| "stop"
	| "uninstall"
	| "repair";
export interface LifecycleResult {
	action: LifecycleAction;
	status: "completed" | "deferred";
	detail?: string;
}
export interface ControlRequest {
	action: LifecycleAction;
	probe: RemoteBackendProbe;
	trustedKeys: TrustedReleaseKeys;
	releaseRoot: string;
}
export interface MaintenanceStatus {
	mode: string;
	safeToRestart: boolean;
	activeChat?: number;
	queuedPrompts?: number;
	waitingApprovals?: number;
	activeCreateOperations?: number;
	activeBackgroundOperations?: number;
	ownerId?: string | null;
	frozen?: boolean;
}

export function assertSafeRestart(status: MaintenanceStatus): void {
	if (
		status.mode !== "draining" ||
		status.safeToRestart !== true ||
		[
			status.activeChat,
			status.queuedPrompts,
			status.waitingApprovals,
			status.activeCreateOperations,
			status.activeBackgroundOperations,
		].some((count) => count !== 0)
	) {
		throw new Error("Backend has active work; activation is deferred");
	}
}

export function compatibleRelease(
	current: {
		protocolVersion: number;
		schemaVersion: number;
		nodeAbi: number;
		target: string;
		files: { path: string; sha256: string }[];
	},
	candidate: {
		protocolVersion: number;
		schemaVersion: number;
		nodeAbi: number;
		target: string;
		files: { path: string; sha256: string }[];
	},
): boolean {
	if (
		current.protocolVersion !== candidate.protocolVersion ||
		current.schemaVersion !== candidate.schemaVersion ||
		current.nodeAbi !== candidate.nodeAbi ||
		current.target !== candidate.target
	)
		return false;
	const migrations = (files: { path: string; sha256: string }[]) =>
		files
			.filter(
				(file) =>
					file.path.startsWith("share/migrations/") ||
					file.path.startsWith("lib/chat-migrations/"),
			)
			.map((file) => `${file.path}:${file.sha256}`)
			.sort();
	return (
		JSON.stringify(migrations(current.files)) ===
		JSON.stringify(migrations(candidate.files))
	);
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export async function controlRemoteBackend(options: {
	transport: RemoteTransport;
	trustedKeys: TrustedReleaseKeys;
	action: LifecycleAction;
	password?: string;
	authorize?: (script: string) => Promise<RemoteCommandResult>;
}): Promise<LifecycleResult> {
	if (
		!["activate", "start", "stop", "uninstall", "repair"].includes(
			options.action,
		)
	)
		throw new Error("Unsupported backend lifecycle action");
	if (
		Object.keys(options.trustedKeys).length === 0 ||
		Object.values(options.trustedKeys).some(
			(key) => createPublicKey(key).asymmetricKeyType !== "ed25519",
		)
	)
		throw new Error("A trusted release key is required");
	const probe = await probeRemoteBackend(options.transport);
	const read = await options.transport.exec(
		'cat "$HOME/.superset-direct/service-config.json"',
	);
	if (read.exitCode !== 0)
		throw new Error("The direct backend is not installed");
	let config: { hostServicePath: string; homeDir: string };
	try {
		config = JSON.parse(read.stdout);
	} catch {
		throw new Error("Invalid backend configuration");
	}
	const pattern =
		/^\/Library\/Application Support\/SupersetDirect\/runtime\/([A-Za-z0-9][A-Za-z0-9._-]{0,63}-[a-f0-9]{24})\/lib\/host-service-direct\.js$/;
	if (
		!pattern.test(config.hostServicePath) ||
		config.homeDir !== `${probe.userHome}/.superset-direct`
	)
		throw new Error("Invalid installed release path");
	const releaseRoot = config.hostServicePath.slice(
		0,
		-"/lib/host-service-direct.js".length,
	);
	const metadata = await options.transport.exec(
		`cat ${quote(`${releaseRoot}/release-manifest.json`)}; printf '\\0'; cat ${quote(`${releaseRoot}/release-signature.json`)}`,
	);
	if (metadata.exitCode !== 0)
		throw new Error("Cannot read the signed installed release");
	const [manifest, signature] = metadata.stdout.split("\0");
	if (!manifest || !signature)
		throw new Error("Missing installed release signature");
	const verified = verifyReleaseManifest(
		Buffer.from(manifest),
		Buffer.from(signature),
		options.trustedKeys,
	);
	if (
		`/Library/Application Support/SupersetDirect/runtime/${verified.releaseId}` !==
			releaseRoot ||
		verified.manifest.target !== probe.target
	)
		throw new Error("Installed release identity changed");
	const node = verified.manifest.files.find((file) => file.path === "lib/node");
	const installer = verified.manifest.files.find(
		(file) => file.path === "lib/direct-installer.js",
	);
	if (!node || !installer)
		throw new Error("Installed release has no trusted control entries");
	const encoded = Buffer.from(
		JSON.stringify({
			action: options.action,
			probe,
			trustedKeys: options.trustedKeys,
			releaseRoot,
		} satisfies ControlRequest),
	).toString("base64");
	const script = `set -eu
[ "$(/usr/bin/id -u)" = 0 ] || exit 77
for directory in '/Library/Application Support/SupersetDirect' '/Library/Application Support/SupersetDirect/runtime' ${quote(releaseRoot)} ${quote(`${releaseRoot}/lib`)}; do
  [ ! -L "$directory" ] && [ -d "$directory" ] && [ "$(/usr/bin/stat -f '%u' "$directory")" = 0 ] || exit 65
  mode=$(/usr/bin/stat -f '%Lp' "$directory")
  [ $((0$mode & 022)) -eq 0 ] || exit 65
done
[ ! -L ${quote(`${releaseRoot}/lib/node`)} ] && [ ! -L ${quote(`${releaseRoot}/lib/direct-installer.js`)} ] || exit 65
nodeDigest=$(/usr/bin/shasum -a 256 ${quote(`${releaseRoot}/lib/node`)})
installerDigest=$(/usr/bin/shasum -a 256 ${quote(`${releaseRoot}/lib/direct-installer.js`)})
[ "${"$"}{nodeDigest%% *}" = '${node.sha256}' ] && [ "${"$"}{installerDigest%% *}" = '${installer.sha256}' ] || exit 65
/usr/bin/env -i HOME=/var/root PATH=/usr/bin:/bin ${quote(`${releaseRoot}/lib/node`)} ${quote(`${releaseRoot}/lib/direct-installer.js`)} --control '${encoded}'
`;
	let result: RemoteCommandResult;
	if (options.authorize) result = await options.authorize(script);
	else if (options.password !== undefined)
		result = await authorizeRemoteScript(
			options.transport,
			script,
			options.password,
		);
	else
		result = await options.transport.exec(
			"/usr/bin/sudo -n /bin/sh -s",
			script,
		);
	if (result.exitCode !== 0)
		throw new Error(
			"Backend lifecycle operation failed; check administrator authorization and remote diagnostics",
		);
	const marker = result.stdout
		.split("\n")
		.find((line) => line.startsWith("SUPERSET_DIRECT_CONTROL="));
	if (!marker)
		throw new Error("Backend lifecycle operation returned no result");
	const controlled = JSON.parse(
		marker.slice("SUPERSET_DIRECT_CONTROL=".length),
	) as LifecycleResult;
	if (
		controlled.action !== options.action ||
		!["completed", "deferred"].includes(controlled.status)
	)
		throw new Error("Invalid backend lifecycle result");
	return controlled;
}
