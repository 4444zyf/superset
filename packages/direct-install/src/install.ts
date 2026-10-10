import { randomUUID } from "node:crypto";
import { join, posix } from "node:path";
import { assertReleaseCapacity, parseDiskFreeBytes } from "./capacity";
import {
	hasControlCharacters,
	type TrustedReleaseKeys,
	verifyReleaseBundle,
} from "./release";

export interface RemoteCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}
export interface RemoteTransport {
	exec(command: string, stdin?: string): Promise<RemoteCommandResult>;
	upload(localPath: string, remotePath: string): Promise<void>;
}
export interface RemoteBackendProbe {
	target: "darwin-arm64" | "darwin-x64";
	uid: number;
	username: string;
	groupname: string;
	userHome: string;
	macOS: string;
}
export interface InstallResult {
	identity: { backendId: string; namespaceId: string; homeDir: string };
	releaseId: string;
	status: "installed" | "already-installed" | "staged";
}
export interface InstallOptions {
	transport: RemoteTransport;
	releaseRoot: string;
	trustedKeys: TrustedReleaseKeys;
	allowedOrigins?: string[];
	password?: string;
	authorize?: (script: string) => Promise<RemoteCommandResult>;
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export async function probeRemoteBackend(
	transport: RemoteTransport,
): Promise<RemoteBackendProbe> {
	const result = await transport.exec(
		'/usr/bin/printf "%s\\0" "$(/usr/bin/uname -s)" "$(/usr/bin/uname -m)" "$(/usr/bin/id -u)" "$(/usr/bin/id -un)" "$(/usr/bin/id -gn)" "$HOME" "$(/usr/bin/sw_vers -productVersion)"',
	);
	if (result.exitCode !== 0) throw new Error("Could not probe the SSH target");
	const [platform, arch, uidText, username, groupname, userHome, macOS] =
		result.stdout.split("\0");
	const uid = Number(uidText);
	if (!Number.isSafeInteger(uid) || uid <= 0)
		throw new Error("The SSH user must not be root");
	if (platform !== "Darwin" || !["arm64", "x86_64"].includes(arch ?? ""))
		throw new Error("Direct backend installation requires macOS arm64 or x64");
	if (
		!username ||
		!groupname ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(username) ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(groupname) ||
		!userHome?.startsWith("/") ||
		hasControlCharacters(userHome) ||
		!macOS ||
		!/^\d+\.\d+(\.\d+)?$/.test(macOS ?? "")
	)
		throw new Error("Invalid remote user identity");
	return {
		target: arch === "arm64" ? "darwin-arm64" : "darwin-x64",
		uid,
		username,
		groupname,
		userHome,
		macOS,
	};
}

export function buildPrivilegedBootstrap(input: {
	incoming: string;
	uid: number;
	nodeSize: number;
	installerSize: number;
	nodeDigest: string;
	installerDigest: string;
	requestBase64: string;
}): string {
	if (
		!input.incoming.startsWith("/") ||
		!Number.isSafeInteger(input.uid) ||
		input.uid <= 0 ||
		!Number.isSafeInteger(input.nodeSize) ||
		input.nodeSize <= 0 ||
		input.nodeSize > 256 * 1024 * 1024 ||
		!Number.isSafeInteger(input.installerSize) ||
		input.installerSize <= 0 ||
		input.installerSize > 16 * 1024 * 1024 ||
		hasControlCharacters(input.incoming) ||
		!/^[a-f0-9]{64}$/.test(input.nodeDigest) ||
		!/^[a-f0-9]{64}$/.test(input.installerDigest) ||
		!/^[A-Za-z0-9+/=]+$/.test(input.requestBase64)
	)
		throw new Error("Invalid privileged installer input");
	return `set -eu
umask 077
[ "$(/usr/bin/id -u)" = 0 ] || exit 77
work=$(/usr/bin/mktemp -d /private/tmp/superset-direct.XXXXXXXX)
trap '/bin/rm -rf "$work"' EXIT HUP INT TERM
payload="$work/payload"
/bin/mkdir "$payload"
/bin/mkdir "$payload/lib"
/usr/bin/sudo -n -u '#${input.uid}' -- /usr/bin/head -c ${input.nodeSize + 1} ${quote(`${input.incoming}/lib/node`)} > "$payload/lib/node"
/usr/bin/sudo -n -u '#${input.uid}' -- /usr/bin/head -c ${input.installerSize + 1} ${quote(`${input.incoming}/lib/direct-installer.js`)} > "$payload/lib/direct-installer.js"
[ -f "$payload/lib/node" ] && [ -f "$payload/lib/direct-installer.js" ] || exit 65
nodeDigest=$(/usr/bin/shasum -a 256 "$payload/lib/node")
installerDigest=$(/usr/bin/shasum -a 256 "$payload/lib/direct-installer.js")
[ "${"$"}{nodeDigest%% *}" = '${input.nodeDigest}' ] || { echo 'Node digest mismatch' >&2; exit 65; }
[ "${"$"}{installerDigest%% *}" = '${input.installerDigest}' ] || { echo 'Installer digest mismatch' >&2; exit 65; }
/bin/chmod 755 "$payload/lib/node"
/usr/bin/printf '%s' '${input.requestBase64}' | /usr/bin/base64 -D > "$work/request.json"
/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/var/root "$payload/lib/node" "$payload/lib/direct-installer.js" --install "$payload" "$work/request.json"
`;
}

function versionAtLeast(actual: string, minimum: string): boolean {
	const parts = actual.split(".").map(Number);
	const required = minimum.split(".").map(Number);
	for (
		let index = 0;
		index < Math.max(parts.length, required.length);
		index++
	) {
		if ((parts[index] ?? 0) !== (required[index] ?? 0))
			return (parts[index] ?? 0) > (required[index] ?? 0);
	}
	return true;
}

export async function installRemoteBackend(
	options: InstallOptions,
): Promise<InstallResult> {
	const verified = verifyReleaseBundle(
		options.releaseRoot,
		options.trustedKeys,
	);
	const probe = await probeRemoteBackend(options.transport);
	if (probe.target !== verified.manifest.target)
		throw new Error("Release architecture does not match the Mac");
	if (!versionAtLeast(probe.macOS, verified.manifest.minimumMacOS))
		throw new Error("The Mac does not meet the release minimum macOS version");
	const disk = await options.transport.exec(
		`LC_ALL=C /bin/df -Pk ${quote(probe.userHome)}`,
	);
	if (disk.exitCode !== 0)
		throw new Error("Cannot inspect available remote disk space");
	assertReleaseCapacity(
		verified.manifest.files.reduce(
			(total, file) => total + file.size,
			verified.manifestBytes.length + verified.signatureBytes.length,
		),
		parseDiskFreeBytes(disk.stdout),
	);
	const installId = randomUUID();
	const incoming = `${probe.userHome}/.superset-direct/incoming/${installId}.partial`;
	try {
		const paths = [
			"release-manifest.json",
			"release-signature.json",
			...verified.manifest.files.map((file) => file.path),
		];
		const directories = [
			...new Set(
				paths.map((path) => posix.dirname(posix.join(incoming, path))),
			),
		];
		for (let index = 0; index < directories.length; index += 50) {
			const created = await options.transport.exec(
				`umask 077; /bin/mkdir -p ${directories
					.slice(index, index + 50)
					.map(quote)
					.join(" ")}`,
			);
			if (created.exitCode !== 0)
				throw new Error("Could not create the private upload directory");
		}
		for (const path of paths)
			await options.transport.upload(
				join(options.releaseRoot, path),
				`${incoming}/${path}`,
			);
		const node = verified.manifest.files.find(
			(file) => file.path === "lib/node",
		);
		const installer = verified.manifest.files.find(
			(file) => file.path === "lib/direct-installer.js",
		);
		if (!node || !installer)
			throw new Error("The release has no trusted bootstrap entries");
		const requestBase64 = Buffer.from(
			JSON.stringify({
				probe,
				incoming,
				manifestBase64: verified.manifestBytes.toString("base64"),
				signatureBase64: verified.signatureBytes.toString("base64"),
				trustedKeys: options.trustedKeys,
				allowedOrigins: options.allowedOrigins ?? [],
				installId,
				expectedReleaseId: verified.releaseId,
			}),
		).toString("base64");
		const script = buildPrivilegedBootstrap({
			incoming,
			uid: probe.uid,
			nodeSize: node.size,
			installerSize: installer.size,
			nodeDigest: node.sha256,
			installerDigest: installer.sha256,
			requestBase64,
		});
		let result: RemoteCommandResult;
		if (options.authorize) result = await options.authorize(script);
		else if (options.password !== undefined) {
			if (
				options.password.includes("\r") ||
				options.password.includes("\n") ||
				options.password.includes("\0")
			)
				throw new Error("Invalid administrator password input");
			const pipeline = `/usr/bin/printf '%s' ${quote(Buffer.from(script).toString("base64"))} | /usr/bin/base64 -D | /bin/sh`;
			result = await options.transport.exec(
				`/usr/bin/sudo -S -p '' /bin/sh -c ${quote(pipeline)}`,
				`${options.password}\n`,
			);
		} else
			result = await options.transport.exec(
				"/usr/bin/sudo -n /bin/sh -s",
				script,
			);
		if (result.exitCode !== 0)
			throw new Error(
				result.exitCode === 77 ||
					/sudo|password|administrator/i.test(result.stderr)
					? "Administrator authorization is required to install the macOS background service"
					: "The verified backend installer failed; the previous service was preserved",
			);
		const marker = result.stdout
			.split("\n")
			.find((line) => line.startsWith("SUPERSET_DIRECT_INSTALL="));
		if (!marker) throw new Error("The installer returned no committed result");
		const installed = JSON.parse(
			marker.slice("SUPERSET_DIRECT_INSTALL=".length),
		) as InstallResult;
		if (
			installed.releaseId !== verified.releaseId ||
			!["installed", "already-installed", "staged"].includes(
				installed.status,
			) ||
			installed.identity?.homeDir !== `${probe.userHome}/.superset-direct` ||
			!/^[a-f0-9-]{36}$/.test(installed.identity.backendId) ||
			!/^[a-f0-9-]{36}$/.test(installed.identity.namespaceId)
		)
			throw new Error("Invalid installer result identity");
		return installed;
	} finally {
		try {
			await options.transport.exec(`/bin/rm -rf ${quote(incoming)}`);
		} catch {}
	}
}
