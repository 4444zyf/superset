import { writeMediaFixtures } from "./verify-media-fixtures.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startPrivateSocketProxy } from "../../../packages/direct-connection/src/local-socket.ts";
import {
	connectAndHello,
	payloadOf,
} from "../../../packages/pty-daemon/test/helpers/client.ts";

const WebSocket = createRequire(
	new URL("../../../packages/direct-connection/package.json", import.meta.url),
)("ws");

export function ownedRestoreControls(home, fixture) {
	assert.equal(lstatSync(home).uid, process.getuid());
	const endpoint = () =>
		JSON.parse(readFileSync(join(home, "state/endpoint.json"), "utf8"));
	const identity = JSON.parse(
		readFileSync(join(home, "identity.json"), "utf8"),
	);
	const socket = join(
		tmpdir(),
		`superset-ptyd-${createHash("sha256")
			.update(`${identity.namespaceId}:${resolve(home)}`)
			.digest("hex")
			.slice(0, 12)}.sock`,
	);
	let originals = [];
	return {
		prepareMediaPreviews(worktreePath) {
			assert.ok(worktreePath.startsWith(join(fixture.homeDir,"Superset Remix","worktrees")+"/"));
			assert.equal(lstatSync(worktreePath).uid,process.getuid());
			return writeMediaFixtures(worktreePath);
		},
		prepareMarkdownPreview(worktreePath, png) {
			const image = this.prepareFilePreviews(worktreePath, png);
			const source = [
				"---", 'title: "Keep literal quotes"', "---",
				"# SSH markdown", "", "Original paragraph.", "",
				"| Name | Value |", "| ---- | ----- |", "| Local | SSH |", "",
				"```js", "const count = 1;", "```", "",
				"![Remote plot](./preview.png)", "",
			].join("\n");
			writeFileSync(join(worktreePath, "README.md"), source, { flag: "wx" });
			return { ...image, source };
		},
		prepareFilePreviews(worktreePath, png) {
			assert.ok(worktreePath.startsWith(join(fixture.homeDir, "Superset Remix", "worktrees") + "/"));
			assert.equal(lstatSync(worktreePath).uid, process.getuid());
			assert.ok(Buffer.isBuffer(png) && png.byteLength < 1024 * 1024);
			for (const [name, bytes] of [
				["preview.png", png],
				["corrupt-preview.png", Buffer.from("invalid PNG")],
				["unknown-preview.bin", Buffer.from([0, 1, 2, 255])],
				["oversized-preview.png", Buffer.alloc(1024 * 1024 + 1)],
			]) writeFileSync(join(worktreePath, name), bytes, { flag: "wx" });
			return { imageBytes: png.byteLength, imageSha256: createHash("sha256").update(png).digest("hex") };
		},
		verifyProjectParent(path) {
			assert.equal(path, fixture.homeDir);
			assert.equal(lstatSync(path).uid, process.getuid());
		},
		async verifyWorktreeLocation(worktreePath) {
			const worktreesRoot = join(
				fixture.homeDir,
				"Superset Remix",
				"worktrees",
			);
			assert.ok(worktreePath.startsWith(worktreesRoot + "/"));
			const client = await connectAndHello(socket);
			try {
				client.send({ type: "list" });
				const list = await client.waitFor((m) => m.type === "list-reply");
				assert.equal(originals.length, 3);
				const terminals = originals.map((ref) => {
					const row = list.sessions.find((s) => s.id === ref.id);
					assert.equal(row?.executionId, ref.executionId);
					assert.equal(row?.alive, true);
					let cwd = null;
					if (process.platform === "linux") {
						assert.equal(lstatSync(`/proc/${row.pid}`).uid, process.getuid());
						cwd = readlinkSync(`/proc/${row.pid}/cwd`);
						assert.equal(cwd, worktreePath);
					}
					return {
						id: row.id,
						executionId: row.executionId,
						pid: row.pid,
						cwd,
					};
				});
				return { worktreesRoot, worktreePath, terminals };
			} finally {
				await client.close();
			}
		},
		prepareGitRemote(worktreePath) {
			assert.ok(
				worktreePath.startsWith(
					join(fixture.homeDir, "Superset Remix", "worktrees") + "/",
				),
			);
			assert.equal(lstatSync(worktreePath).uid, process.getuid());
			const remote = join(fixture.root, "push-remote.git");
			execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
			execFileSync("git", ["remote", "add", "origin", remote], {
				cwd: worktreePath,
				stdio: "pipe",
			});
			return {
				advanceRemote(branch, content) {
					const sender = join(fixture.root, "sync-sender");
					if (!existsSync(sender))
						execFileSync("git", ["clone", "--branch", branch, remote, sender], {
							stdio: "pipe",
						});
					const git = (args) =>
						execFileSync("git", args, { cwd: sender, stdio: "pipe" });
					git(["pull", "--rebase"]);
					writeFileSync(join(sender, "sync-ui.txt"), content);
					git(["add", "sync-ui.txt"]);
					git([
						"-c",
						"user.name=Sync Fixture",
						"-c",
						"user.email=sync@example.invalid",
						"-c",
						"commit.gpgsign=false",
						"commit",
						"-m",
						"Remote sync fixture update",
					]);
					git(["push"]);
					return execFileSync("git", ["rev-parse", "HEAD"], {
						cwd: sender,
						encoding: "utf8",
					}).trim();
				},
				readHead(branch) {
					return execFileSync(
						"git",
						["--git-dir", remote, "rev-parse", "refs/heads/" + branch],
						{ encoding: "utf8" },
					).trim();
				},
			};
		},
		trackOriginals(refs) {
			originals = refs;
		},
		async inspectRunExecution(run, expectedPid) {
			const client = await connectAndHello(socket);
			try {
				client.send({ type: "list" });
				const list = await client.waitFor((m) => m.type === "list-reply");
				const row = list.sessions.find((s) => s.id === run.terminalId);
				if (!row) {
					assert.ok(Number.isSafeInteger(expectedPid) && expectedPid > 0);
					assert.equal(process.platform, "linux");
					return {
						id: run.terminalId,
						executionId: run.executionId,
						pid: expectedPid,
						cwd: null,
						alive: false,
						removed: true,
						processExists: existsSync(`/proc/${expectedPid}`),
						output: "",
					};
				}
				assert.equal(row.executionId, run.executionId);
				if (expectedPid !== undefined) assert.equal(row.pid, expectedPid);
				let output = "";
				if (row.alive) {
					client.send({
						type: "subscribe",
						id: row.id,
						executionId: row.executionId,
						replay: true,
						modeSnapshot: true,
					});
					await client.waitFor(
						(m) => m.type === "replay-complete" && m.id === row.id,
					);
					output = Buffer.concat(
						client.messages
							.filter((m) => m.type === "output" && m.id === row.id)
							.map((m) => Buffer.from(payloadOf(m) ?? [])),
					).toString("utf8");
				}
				let cwd = null;
				if (row.alive && process.platform === "linux") {
					assert.equal(lstatSync(`/proc/${row.pid}`).uid, process.getuid());
					cwd = readlinkSync(`/proc/${row.pid}/cwd`);
				}
				return {
					id: row.id,
					executionId: row.executionId,
					pid: row.pid,
					cwd,
					alive: row.alive,
					processExists:
						process.platform === "linux"
							? existsSync(`/proc/${row.pid}`)
							: row.alive,
					output,
				};
			} finally {
				await client.close();
			}
		},
		async observeWhileClientClosed() {
			return Promise.all(
				originals.map(async (ref) => {
					const client = await connectAndHello(socket);
					try {
						client.send({ type: "list" });
						const list = await client.waitFor((m) => m.type === "list-reply");
						const row = list.sessions.find((s) => s.id === ref.id);
						assert.equal(row?.executionId, ref.executionId);
						assert.equal(row?.alive, true);
						client.send({
							type: "subscribe",
							id: ref.id,
							executionId: ref.executionId,
							replay: true,
							modeSnapshot: true,
						});
						await client.waitFor(
							(m) => m.type === "replay-complete" && m.id === ref.id,
						);
						const fresh = await client.waitForNext(
							(m) => m.type === "output" && m.id === ref.id,
							10000,
						);
						assert.ok(payloadOf(fresh)?.byteLength);
						return {
							id: ref.id,
							executionId: ref.executionId,
							pid: row.pid,
							newOutputBytes: payloadOf(fresh).byteLength,
						};
					} finally {
						await client.close();
					}
				}),
			);
		},
		async verifyHeaderOnly(ref) {
			const config = JSON.parse(
				readFileSync(join(home, "service-config.json"), "utf8"),
			);
			const secret = readFileSync(config.secretFile, "utf8").trim();
			const proxy = await startPrivateSocketProxy(endpoint().socketPath);
			const path = `/terminal-restore/${ref.resourceId}?workspaceId=${ref.workspaceId}&executionId=${ref.executionId}`;
			let socket;
			try {
				assert.equal(
					(
						await fetch(
							proxy.url + path + "&token=" + encodeURIComponent(secret),
						)
					).status,
					401,
				);
				socket = new WebSocket(proxy.url.replace(/^http/, "ws") + path, {
					headers: { Authorization: `Bearer ${secret}` },
				});
				await new Promise((resolve, reject) => {
					const timer = setTimeout(
						() =>
							reject(
								new Error("Header-authenticated attachment did not complete"),
							),
						10000,
					);
					socket.on("message", (data, binary) => {
						if (binary) return;
						const message = JSON.parse(String(data));
						if (message.type === "attached") {
							clearTimeout(timer);
							assert.equal(message.executionId, ref.executionId);
							resolve();
						} else if (message.type === "error") {
							clearTimeout(timer);
							reject(new Error(message.code));
						}
					});
					socket.once("error", () => {
						clearTimeout(timer);
						reject(new Error("Header-authenticated attachment failed"));
					});
				});
				return true;
			} finally {
				socket?.terminate();
				proxy.close();
			}
		},
		setAvailable: (value) => fixture.setAvailable(value),
		async restartHost() {
			const before = endpoint();
			const lock = join(home, "state/backend.lock");
			assert.equal(lstatSync(lock).uid, process.getuid());
			const match = /^superset-direct-lock-(\d+)-[a-f0-9-]{36}$/.exec(
				readlinkSync(lock),
			);
			assert.ok(match);
			process.kill(Number(match[1]), "SIGKILL");
			for (let i = 0; i < 100; i++) {
				try {
					const after = endpoint();
					if (after.instanceId !== before.instanceId)
						return { before: before.instanceId, after: after.instanceId };
				} catch {}
				await delay(100);
			}
			throw new Error("Owned backend did not restart");
		},
		async killDaemon() {
			const client = await connectAndHello(socket);
			const ack = client.messages.find((m) => m.type === "hello-ack");
			assert.ok(ack?.daemonPid && ack.daemonPid !== process.pid);
			await client.close();
			process.kill(ack.daemonPid, "SIGKILL");
		},
	};
}
