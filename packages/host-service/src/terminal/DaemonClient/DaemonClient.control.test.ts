import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CURRENT_PROTOCOL_VERSION,
	encodeFrame,
	FrameDecoder,
} from "@superset/pty-daemon/protocol";
import { DaemonClient } from "./DaemonClient";

test.each([
	true,
	false,
])("conditional terminal close forwards its execution only when advertised (%s)", async (supported) => {
	const root = mkdtempSync(join(tmpdir(), "run-control-wire-")),
		socketPath = join(root, "daemon.sock");
	const sockets: Socket[] = [],
		frames: unknown[] = [];
	const server = createServer((socket) => {
		sockets.push(socket);
		const decoder = new FrameDecoder();
		socket.on("data", (chunk) => {
			decoder.push(chunk);
			for (const frame of decoder.drain()) {
				const message = frame.message as {
					type: string;
					id: string;
					executionId?: string;
				};
				if (message.type === "hello")
					socket.write(
						encodeFrame({
							type: "hello-ack",
							protocol: CURRENT_PROTOCOL_VERSION,
							daemonVersion: "test",
							supportsConditionalSubscribe: supported,
						}),
					);
				if (message.type === "close") {
					frames.push(message);
					socket.write(
						encodeFrame(
							message.executionId === "expected"
								? { type: "closed", id: message.id }
								: {
										type: "error",
										id: message.id,
										code: "EEXECUTION",
										message: "Terminal execution changed",
									},
						),
					);
				}
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	const client = new DaemonClient({ socketPath });
	try {
		await client.connect();
		if (supported) {
			await client.closeExisting("terminal", "expected", "SIGKILL");
			await expect(
				client.closeExisting("terminal", "stale", "SIGKILL"),
			).rejects.toThrow("execution changed");
			expect(frames).toHaveLength(2);
			expect(frames[0]).toMatchObject({
				type: "close",
				id: "terminal",
				executionId: "expected",
				signal: "SIGKILL",
			});
		} else {
			await expect(
				client.closeExisting("terminal", "expected", "SIGKILL"),
			).rejects.toThrow("unsupported");
			expect(frames).toHaveLength(0);
		}
	} finally {
		await client.dispose();
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
