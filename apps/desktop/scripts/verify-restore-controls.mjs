import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { connectAndHello } from "../../../packages/pty-daemon/test/helpers/client.ts";
import { startPrivateSocketProxy } from "../../../packages/direct-connection/src/local-socket.ts";
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
	return {
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
