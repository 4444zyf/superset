import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { OwnedSshProcesses } from "./owned-processes";
import type { ConnectionProfile } from "./registry";
import { validateProfile } from "./registry";
import { spawnOwnedSsh } from "./ssh-process";

export interface RemoteCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}
export interface RemoteTransport {
	exec(command: string, stdin?: string): Promise<RemoteCommandResult>;
	upload(localPath: string, remotePath: string): Promise<void>;
	uploadFiles?(files: readonly UploadFile[]): Promise<void>;
}
export interface UploadFile {
	localPath: string;
	remotePath: string;
}
export interface Tunnel {
	url: string;
	close(): void;
}
export interface SshRuntime {
	cancel?(connectionId: string): void;
	dispose?(): void;
	exec(
		profile: ConnectionProfile,
		command: string,
		stdin?: string,
	): Promise<RemoteCommandResult>;
	upload(
		profile: ConnectionProfile,
		localPath: string,
		remotePath: string,
	): Promise<void>;
	uploadFiles?(
		profile: ConnectionProfile,
		files: readonly UploadFile[],
	): Promise<void>;
	forward(
		profile: ConnectionProfile,
		target: number | string,
		onExit: () => void,
	): Promise<Tunnel>;
}

export function sshArguments(profile: ConnectionProfile): string[] {
	validateProfile(profile);
	const args = [
		"-T",
		"-o",
		"BatchMode=yes",
		"-o",
		"StrictHostKeyChecking=yes",
		"-o",
		"ForwardAgent=no",
		"-o",
		"ControlMaster=no",
		"-o",
		"ControlPath=none",
		"-o",
		"ControlPersist=no",
		"-o",
		"ClearAllForwardings=yes",
		"-o",
		"ExitOnForwardFailure=yes",
		"-o",
		"ServerAliveInterval=15",
		"-o",
		"ServerAliveCountMax=3",
		"-o",
		"ConnectTimeout=10",
		"-o",
		"PermitLocalCommand=no",
		"-o",
		"RemoteCommand=none",
		"-o",
		"SessionType=default",
		"-o",
		"ForwardX11=no",
	];
	if (profile.port !== undefined) args.push("-p", String(profile.port));
	if (profile.user) args.push("-l", profile.user);
	if (profile.identityFile) args.push("-i", profile.identityFile);
	args.push(profile.host);
	return args;
}

export function masterArguments(
	profile: ConnectionProfile,
	socketPath: string,
): string[] {
	const args = sshArguments(profile);
	args[args.indexOf("ControlMaster=no")] = "ControlMaster=yes";
	args[args.indexOf("ControlPath=none")] = `ControlPath=${socketPath}`;
	return ["-N", ...args];
}

export function sftpArguments(
	profile: ConnectionProfile,
	batch: string,
): string[] {
	const ssh = sshArguments(profile);
	const args: string[] = [];
	for (let index = 1; index < ssh.length - 1; index += 2) {
		const flag = ssh[index];
		const value = ssh[index + 1];
		if (!flag || value === undefined) throw new Error("Invalid SSH arguments");
		if (flag === "-o" && value === "SessionType=default") continue;
		if (flag === "-p") args.push("-P", value);
		else if (flag === "-l") args.push("-o", `User=${value}`);
		else args.push(flag, value);
	}
	return ["-b", batch, ...args, profile.host];
}

export function sftpUploadBatch(files: readonly UploadFile[]): string {
	const quote = (value: string) =>
		`"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
	return files
		.map(({ localPath, remotePath }) => {
			if ([localPath, remotePath].some((path) => /[\r\n\0]/.test(path)))
				throw new Error("Invalid SFTP path");
			return `@put ${quote(localPath)} ${quote(remotePath)}\n`;
		})
		.join("");
}

export function forwardArguments(
	host: string,
	socketPath: string,
	emptyConfig: string,
	localPort: number,
	remoteTarget: number | string,
): string[] {
	validateForwardTarget(remoteTarget);
	if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)
		throw new Error("Invalid local forwarding port");
	return [
		"-F",
		emptyConfig,
		"-S",
		socketPath,
		"-O",
		"forward",
		"-o",
		"BatchMode=yes",
		"-L",
		`127.0.0.1:${localPort}:${typeof remoteTarget === "number" ? `127.0.0.1:${remoteTarget}` : remoteTarget}`,
		host,
	];
}

function validateForwardTarget(target: number | string): void {
	if (
		typeof target === "number"
			? !Number.isInteger(target) || target < 1 || target > 65535
			: !isSafeSocketPath(target)
	)
		throw new Error("Invalid backend forwarding target");
}

export function isSafeSocketPath(path: string): boolean {
	return (
		path.startsWith("/") &&
		Buffer.byteLength(path) <= 103 &&
		!Array.from(path).some(
			(character) =>
				character.charCodeAt(0) <= 32 ||
				character.charCodeAt(0) === 127 ||
				character === ":" ||
				character === "\\",
		)
	);
}

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Unable to allocate SSH port"));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
}

function execute(
	program: string,
	args: string[],
	stdin?: string,
	owner?: {
		processes: OwnedSshProcesses;
		connectionId: string;
		version?: number;
		cleanupDirectory?: string;
	},
): Promise<RemoteCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawnOwnedSsh(program, args, {
			stdio: "pipe",
			cleanupDirectory: owner?.cleanupDirectory,
		});
		owner?.processes.track(owner.connectionId, child, owner.version);
		let stdout = "";
		let stderr = "";
		let exceeded = false;
		let outputBytes = 0;
		const stdoutDecoder = new StringDecoder("utf8");
		const stderrDecoder = new StringDecoder("utf8");
		const collect = (stream: "stdout" | "stderr", bytes: Buffer) => {
			if (exceeded) return;
			if (outputBytes + bytes.length > 4 * 1024 * 1024) {
				exceeded = true;
				child.stdout.destroy();
				child.stderr.destroy();
				child.kill();
				return;
			}
			outputBytes += bytes.length;
			if (stream === "stdout") stdout += stdoutDecoder.write(bytes);
			else stderr += stderrDecoder.write(bytes);
		};
		child.stdout.on("data", (bytes) => collect("stdout", bytes));
		child.stderr.on("data", (bytes) => collect("stderr", bytes));
		child.once("error", reject);
		child.stdin.on("error", () => {});
		child.once("close", (code) =>
			exceeded
				? reject(new Error("SSH response exceeds limit"))
				: resolve({
						stdout: stdout + stdoutDecoder.end(),
						stderr: stderr + stderrDecoder.end(),
						exitCode: code ?? 255,
					}),
		);
		child.stdin.end(stdin);
	});
}

export class OpenSshRuntime implements SshRuntime {
	private readonly processes = new OwnedSshProcesses();
	constructor(private readonly options: { configFile?: string } = {}) {}
	private configArguments(): string[] {
		return this.options.configFile ? ["-F", this.options.configFile] : [];
	}
	cancel(connectionId: string): void {
		this.processes.cancel(connectionId);
	}
	dispose(): void {
		this.processes.dispose();
	}
	async exec(
		profile: ConnectionProfile,
		command: string,
		stdin?: string,
	): Promise<RemoteCommandResult> {
		return execute(
			"ssh",
			[...this.configArguments(), ...sshArguments(profile), command],
			stdin,
			{
				processes: this.processes,
				connectionId: profile.id,
			},
		);
	}
	async upload(
		profile: ConnectionProfile,
		localPath: string,
		remotePath: string,
	): Promise<void> {
		return this.uploadFiles(profile, [{ localPath, remotePath }]);
	}
	async uploadFiles(
		profile: ConnectionProfile,
		files: readonly UploadFile[],
	): Promise<void> {
		const version = this.processes.version(profile.id);
		const commands = sftpUploadBatch(files);
		if (!commands) return;
		const directory = await mkdtemp(join(tmpdir(), "superset-sftp-"));
		const batch = join(directory, randomUUID());
		try {
			await writeFile(batch, commands, {
				mode: 0o600,
			});
			const result = await execute(
				"sftp",
				[...this.configArguments(), ...sftpArguments(profile, batch)],
				undefined,
				{
					processes: this.processes,
					connectionId: profile.id,
					version,
					cleanupDirectory: directory,
				},
			);
			if (result.exitCode !== 0)
				throw new Error(
					`SFTP upload failed: ${result.stderr.trim().slice(0, 2048) || `exit ${result.exitCode}`}`,
				);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
	async forward(
		profile: ConnectionProfile,
		target: number | string,
		onExit: () => void,
	): Promise<Tunnel> {
		const version = this.processes.version(profile.id);
		validateForwardTarget(target);
		const directory = await mkdtemp(
			join(process.platform === "win32" ? tmpdir() : "/tmp", "superset-ssh-"),
		);
		const socketPath = join(directory, "control");
		const emptyConfig = join(directory, "empty-config");
		await writeFile(emptyConfig, "", { mode: 0o600 });
		const child = spawnOwnedSsh(
			"ssh",
			[...this.configArguments(), ...masterArguments(profile, socketPath)],
			{
				stdio: "ignore",
				cleanupDirectory: directory,
			},
		);
		this.processes.track(profile.id, child, version);
		let exited = false;
		child.once("exit", () => {
			exited = true;
			void rm(directory, { recursive: true, force: true });
			onExit();
		});
		try {
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", resolve);
				child.once("error", reject);
			});
			let ready = false;
			for (let attempt = 0; attempt < 100; attempt++) {
				if (exited)
					throw new Error(
						"Private SSH control connection failed; check system OpenSSH support",
					);
				try {
					await access(socketPath);
					ready = true;
					break;
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
			if (!ready)
				throw new Error("Private SSH control connection did not become ready");
			for (let attempt = 0; attempt < 3; attempt++) {
				const localPort = await freePort();
				const result = await execute(
					"ssh",
					forwardArguments(
						profile.host,
						socketPath,
						emptyConfig,
						localPort,
						target,
					),
					undefined,
					{ processes: this.processes, connectionId: profile.id, version },
				);
				if (result.exitCode === 0 && !exited)
					return {
						url: `http://127.0.0.1:${localPort}`,
						close: () => {
							child.kill();
						},
					};
			}
			throw new Error("SSH loopback forwarding failed");
		} catch (error) {
			child.kill();
			await rm(directory, { recursive: true, force: true });
			throw error;
		}
	}
}
