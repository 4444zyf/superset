import { execFile } from "node:child_process";
import {
	createHash,
	createPrivateKey,
	createPublicKey,
	sign,
} from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	type ReleaseFile,
	type ReleaseManifest,
	verifyReleaseBundle,
} from "@superset/direct-install";
import { linguiMacroPlugin } from "@superset/i18n/bun-plugin";
import {
	buildPtyDaemon,
	copyRuntimePackages,
	downloadAndExtractNode,
	fixNativeBinariesForNode,
} from "./build-dist";

function argument(name: string): string {
	const value = process.argv
		.find((arg) => arg.startsWith(`--${name}=`))
		?.slice(name.length + 3);
	if (!value) throw new Error(`Missing required --${name}=...`);
	return value;
}

const DIRECT_NODE_RELEASES: Readonly<
	Record<string, { nodeAbi: number; minimumMacOS: string }>
> = {
	"24.21.0": { nodeAbi: 137, minimumMacOS: "13.5" },
	"22.23.3": { nodeAbi: 127, minimumMacOS: "11.0" },
};
export function resolveDirectRuntime(
	nodeVersion: string,
	nodeAbi: number,
	minimumMacOS?: string,
): { nodeVersion: string; nodeAbi: number; minimumMacOS: string } {
	const pinned = DIRECT_NODE_RELEASES[nodeVersion];
	if (!pinned)
		throw new Error(
			"The Node version is not an approved supported LTS release",
		);
	if (nodeAbi !== pinned.nodeAbi)
		throw new Error("The native ABI does not match the pinned Node runtime");
	const selected = minimumMacOS ?? pinned.minimumMacOS;
	const floor = pinned.minimumMacOS.split(".").map(Number);
	const actual = selected.split(".").map(Number);
	if (
		!/^\d+\.\d+(\.\d+)?$/.test(selected) ||
		(actual[0] ?? 0) < (floor[0] ?? 0) ||
		(actual[0] === floor[0] && (actual[1] ?? 0) < (floor[1] ?? 0))
	)
		throw new Error(
			"The minimum macOS version is below the pinned runtime requirement",
		);
	return { nodeVersion, nodeAbi, minimumMacOS: selected };
}

export function listReleaseFiles(root: string): ReleaseFile[] {
	const files: ReleaseFile[] = [];
	function walk(directory: string, prefix = ""): void {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name),
		)) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(directory, entry.name), path);
			else if (entry.isFile()) {
				const bytes = readFileSync(join(root, path));
				const mode = statSync(join(root, path)).mode & 0o111 ? 0o755 : 0o644;
				chmodSync(join(root, path), mode);
				files.push({
					path,
					size: bytes.length,
					sha256: createHash("sha256").update(bytes).digest("hex"),
					mode,
				});
			} else
				throw new Error(
					`The release contains a symlink or special file: ${path}`,
				);
		}
	}
	walk(root);
	return files;
}

export function signRelease(
	root: string,
	metadata: Omit<ReleaseManifest, "files" | "formatVersion">,
	keyId: string,
	privateKeyPem: string,
): void {
	const key = createPrivateKey(privateKeyPem);
	if (key.asymmetricKeyType !== "ed25519" || !/^[a-zA-Z0-9._-]+$/.test(keyId))
		throw new Error(
			"A trusted Ed25519 release signing key and key ID are required",
		);
	const manifest: ReleaseManifest = {
		formatVersion: 1,
		...metadata,
		files: listReleaseFiles(root),
	};
	const bytes = Buffer.from(JSON.stringify(manifest));
	writeFileSync(join(root, "release-manifest.json"), bytes);
	writeFileSync(
		join(root, "release-signature.json"),
		JSON.stringify({
			keyId,
			signature: sign(null, bytes, key).toString("base64"),
		}),
	);
}

async function bundle(
	entrypoint: string,
	outfile: string,
	external: string[] = [],
): Promise<void> {
	const result = await Bun.build({
		entrypoints: [entrypoint],
		plugins: [linguiMacroPlugin],
		target: "node",
		format: "esm",
		outdir: join(outfile, ".."),
		naming: outfile.split("/").at(-1),
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		external,
	});
	if (!result.success)
		throw new Error(result.logs.map((log) => log.message).join("\n"));
}

async function main(): Promise<void> {
	const target = argument("target");
	if (target !== "darwin-arm64" && target !== "darwin-x64")
		throw new Error("Direct releases support darwin-arm64 and darwin-x64");
	const nodeVersion = argument("node-version");
	const nodeAbi = Number(argument("node-abi"));
	const minimumMacOS = process.argv
		.find((value) => value.startsWith("--minimum-macos="))
		?.slice("--minimum-macos=".length);
	const runtime = resolveDirectRuntime(nodeVersion, nodeAbi, minimumMacOS);
	if (
		!/^\d+\.\d+\.\d+$/.test(nodeVersion) ||
		!Number.isInteger(nodeAbi) ||
		nodeAbi <= 0 ||
		!/^\d+\.\d+(\.\d+)?$/.test(runtime.minimumMacOS)
	)
		throw new Error(
			"Pin a supported Node LTS version and its matching native ABI",
		);
	const keyId = argument("key-id");
	const keyPem = readFileSync(resolve(argument("signing-key-file")), "utf8");
	const version = JSON.parse(
		readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"),
	).version as string;
	if (process.platform !== "darwin" || process.arch !== target.split("-")[1])
		throw new Error(
			"A direct release must be built and smoke-tested on a macOS worker of the target architecture",
		);
	const root = resolve(import.meta.dir, `../dist/superset-direct-${target}`);
	if (existsSync(root)) rmSync(root, { recursive: true });
	for (const directory of ["lib", "share"])
		mkdirSync(join(root, directory), { recursive: true });
	const hostRoot = resolve(import.meta.dir, "../../host-service");
	const nativeExternals = [
		"better-sqlite3",
		"node-pty",
		"@parcel/watcher",
		"@anthropic-ai/claude-agent-sdk",
		"puppeteer-core",
		"chromium-bidi",
	];
	await bundle(
		join(hostRoot, "src/direct-serve.ts"),
		join(root, "lib/host-service-direct.js"),
		nativeExternals,
	);
	await bundle(
		join(hostRoot, "src/direct-supervisor.ts"),
		join(root, "lib/direct-supervisor.js"),
	);
	await bundle(
		join(hostRoot, "src/workers/host-worker.ts"),
		join(root, "lib/host-worker.js"),
	);
	await bundle(
		resolve(
			import.meta.dir,
			"../../direct-install/src/privileged-installer.ts",
		),
		join(root, "lib/direct-installer.js"),
	);
	cpSync(await buildPtyDaemon(), join(root, "lib/pty-daemon.js"));
	await downloadAndExtractNode(target, join(root, "lib"), nodeVersion);
	copyRuntimePackages(join(root, "lib"), target, [
		"@anthropic-ai/claude-agent-sdk",
		`@anthropic-ai/claude-agent-sdk-${target}`,
		"@agentclientprotocol/claude-agent-acp",
		"@agentclientprotocol/codex-acp",
		"pi-acp",
	]);
	await fixNativeBinariesForNode(join(root, "lib"), target, String(nodeAbi));
	cpSync(join(hostRoot, "drizzle"), join(root, "share/migrations"), {
		recursive: true,
	});
	cpSync(
		resolve(import.meta.dir, "../../chat-runtime/src/db/drizzle"),
		join(root, "lib/chat-migrations"),
		{ recursive: true },
	);
	cpSync(
		resolve(import.meta.dir, "../../agent-setup/templates"),
		join(root, "lib/agent-templates"),
		{ recursive: true },
	);
	const run = promisify(execFile);
	const actualRuntime = JSON.parse(
		(
			await run(join(root, "lib/node"), [
				"-p",
				"JSON.stringify({version:process.versions.node,abi:Number(process.versions.modules)})",
			])
		).stdout,
	) as { version: string; abi: number };
	if (
		actualRuntime.version !== runtime.nodeVersion ||
		actualRuntime.abi !== runtime.nodeAbi
	)
		throw new Error(
			"The bundled Node version or ABI differs from the approved runtime",
		);
	await run(join(root, "lib/node"), [
		join(root, "lib/direct-installer.js"),
		"--smoke-user",
		Buffer.from("{}").toString("base64"),
	]);
	await run(
		join(root, "lib/node"),
		[
			"--input-type=module",
			"-e",
			"await import(process.argv[1])",
			join(root, "lib/host-service-direct.js"),
		],
		{
			cwd: root,
			env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
		},
	);
	signRelease(
		root,
		{
			version,
			target,
			protocolVersion: 1,
			schemaVersion: 1,
			minimumMacOS: runtime.minimumMacOS,
			nodeVersion,
			nodeAbi,
		},
		keyId,
		keyPem,
	);
	verifyReleaseBundle(root, {
		[keyId]: createPublicKey(keyPem)
			.export({ format: "pem", type: "spki" })
			.toString(),
	});
	console.log(`[build-direct] signed standalone backend: ${root}`);
}
if (import.meta.main) await main();
