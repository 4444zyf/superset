import { readFile, writeFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createSshFixture } from "./ssh-fixture.ts";

class ShapedStream extends Transform {
	private queuedBytes = 0;
	private nextDelivery = 0;
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();
	private waiting?: TransformCallback;
	private finish?: TransformCallback;
	constructor(
		private readonly oneWayMs: number,
		private readonly bytesPerSecond: number,
	) {
		super();
	}
	_transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: TransformCallback,
	) {
		this.queuedBytes += chunk.length;
		const now = performance.now();
		const due =
			Math.max(now + this.oneWayMs, this.nextDelivery) +
			(chunk.length / this.bytesPerSecond) * 1000;
		this.nextDelivery = due;
		const timer = setTimeout(
			() => {
				this.timers.delete(timer);
				this.queuedBytes -= chunk.length;
				this.push(chunk);
				const waiting = this.waiting;
				this.waiting = undefined;
				waiting?.();
				if (this.queuedBytes === 0) {
					const finish = this.finish;
					this.finish = undefined;
					finish?.();
				}
			},
			Math.max(0, due - now),
		);
		this.timers.add(timer);
		if (this.queuedBytes >= 1024 * 1024) this.waiting = callback;
		else callback();
	}
	_flush(callback: TransformCallback) {
		if (this.queuedBytes === 0) callback();
		else this.finish = callback;
	}
	_destroy(error: Error | null, callback: (error: Error | null) => void) {
		for (const timer of this.timers) clearTimeout(timer);
		this.waiting?.(error ?? new Error("Network relay closed"));
		this.finish?.(error ?? new Error("Network relay closed"));
		callback(error);
	}
}

export async function createShapedSshFixture(
	rttMs: number,
	megabitsPerSecond: number,
	options: { isolateHome?: boolean } = {},
) {
	const fixture = await createSshFixture(options);
	const sockets = new Set<Socket>();
	const streams = new Set<ShapedStream>();
	const server = createServer((client) => {
		const upstream = connect(fixture.profile.port, "127.0.0.1");
		sockets.add(client);
		sockets.add(upstream);
		client.setNoDelay();
		upstream.setNoDelay();
		for (const [source, destination] of [
			[client, upstream],
			[upstream, client],
		]) {
			const stream = new ShapedStream(
				rttMs / 2,
				(megabitsPerSecond * 1_000_000) / 8,
			);
			streams.add(stream);
			void pipeline(source as Socket, stream, destination as Socket)
				.catch(() => {})
				.finally(() => streams.delete(stream));
		}
		client.once("close", () => {
			sockets.delete(client);
			upstream.destroy();
		});
		upstream.once("close", () => {
			sockets.delete(upstream);
			client.destroy();
		});
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Network relay could not listen");
		const config = await readFile(fixture.configFile, "utf8");
		await writeFile(
			fixture.configFile,
			`${config}  HostKeyAlias [127.0.0.1]:${fixture.profile.port}\n`,
			{ mode: 0o600 },
		);
		return {
			...fixture,
			profile: { ...fixture.profile, port: address.port },
			async close() {
				for (const socket of sockets) socket.destroy();
				for (const stream of streams) stream.destroy();
				await new Promise<void>((resolve) => server.close(() => resolve()));
				await fixture.close();
			},
		};
	} catch (error) {
		server.close();
		await fixture.close();
		throw error;
	}
}
