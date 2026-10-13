import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export async function createSshFixture(
	options: { isolateHome?: boolean } = {},
) {
	const root = await mkdtemp(join(homedir(), ".superset-ssh-test-"));
	const run = promisify(execFile);
	let daemon: ReturnType<typeof spawn> | undefined;
	let authenticatedConnections = 0;
	let logBuffer = "";
	const homeDir = options.isolateHome ? join(root, "backend-home") : homedir();
	try {
		for (const key of ["host", "client"])
			await run("ssh-keygen", [
				"-q",
				"-t",
				"ed25519",
				"-N",
				"",
				"-f",
				join(root, key),
			]);
		await writeFile(
			join(root, "authorized_keys"),
			await readFile(join(root, "client.pub")),
			{ mode: 0o600 },
		);
		const port = await new Promise<number>((resolve, reject) => {
			const server = createServer();
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string")
					return reject(new Error("Fixture port unavailable"));
				server.close((error) =>
					error ? reject(error) : resolve(address.port),
				);
			});
		});
		const username = userInfo().username;
		const configFile = join(root, "client_config");
		const hostKey = (await readFile(join(root, "host.pub"), "utf8")).trim();
		await writeFile(
			join(root, "known_hosts"),
			`[127.0.0.1]:${port} ${hostKey}\n`,
			{ mode: 0o600 },
		);
		await writeFile(
			configFile,
			`Host *\n  UserKnownHostsFile "${join(root, "known_hosts")}"\n  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n`,
			{ mode: 0o600 },
		);
		const serverConfig = join(root, "server_config");
		if (options.isolateHome) {
			await mkdir(homeDir, { mode: 0o700 });
			const sftpServer =
				process.platform === "darwin"
					? "/usr/libexec/sftp-server"
					: "/usr/lib/openssh/sftp-server";
			await writeFile(
				join(root, "command.sh"),
				`#!/bin/sh\nexport HOME='${homeDir.replaceAll("'", "'\\''")}'\ncase "$SSH_ORIGINAL_COMMAND" in internal-sftp) exec ${sftpServer};; *) exec /bin/sh -c "$SSH_ORIGINAL_COMMAND";; esac\n`,
				{ mode: 0o700 },
			);
		}
		await writeFile(
			serverConfig,
			`Port ${port}\nListenAddress 127.0.0.1\nHostKey ${join(root, "host")}\nPidFile ${join(root, "pid")}\nAuthorizedKeysFile ${join(root, "authorized_keys")}\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nStrictModes yes\nAllowUsers ${username}\nAllowTcpForwarding local\nAllowAgentForwarding no\nX11Forwarding no\nSubsystem sftp internal-sftp\nLogLevel VERBOSE\n${options.isolateHome ? `ForceCommand ${join(root, "command.sh")}\n` : ""}`,
			{ mode: 0o600 },
		);
		daemon = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", serverConfig], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		const process_ = daemon;
		process_.stderr?.on("data", (bytes) => {
			logBuffer += bytes.toString();
			const lines = logBuffer.split("\n");
			logBuffer = lines.pop() ?? "";
			for (const line of lines)
				if (line.includes("Accepted publickey")) authenticatedConnections++;
		});
		const exited = new Promise<void>((resolve) =>
			process_.once("exit", () => resolve()),
		);
		await new Promise<void>((resolve, reject) => {
			let logs = "";
			process_.once("error", reject);
			process_.once("exit", () =>
				reject(new Error(`Fixture SSH server exited: ${logs}`)),
			);
			process_.stderr?.on("data", (bytes) => {
				logs += bytes.toString();
				if (logs.includes("Server listening")) resolve();
			});
		});
		return {
			homeDir,
			stats: () => ({ authenticatedConnections }),
			root,
			configFile,
			profile: {
				id: randomUUID(),
				name: "Isolated SSH fixture",
				host: "127.0.0.1",
				port,
				user: username,
				identityFile: join(root, "client"),
			},
			async close() {
				process_.kill();
				await exited;
				await rm(root, { recursive: true, force: true });
			},
		};
	} catch (error) {
		daemon?.kill();
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}
