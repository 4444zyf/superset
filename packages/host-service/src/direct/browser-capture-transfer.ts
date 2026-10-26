import { randomUUID } from "node:crypto";
import {
	BROWSER_CAPTURE_MAX_BASE64_CHARS,
	browserBridgeCaptureRequestSchema,
	validateBrowserCaptureBase64,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";

interface PendingCapture {
	id: string;
	chunks: string[];
	characters: number;
	cancel(): void;
	resolve(value: { base64: string }): void;
	reject(error: Error): void;
}
type Failure = "unavailable" | "busy" | "timeout" | "invalid" | "failed";

export class BrowserCaptureTransfer {
	private pending: PendingCapture | null = null;
	constructor(
		private readonly options: {
			ready(): boolean;
			send(packet: BrowserBridgePacket): void;
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	capturePng(workspaceId: string, paneId: string): Promise<{ base64: string }> {
		if (!this.options.ready())
			return Promise.reject(
				this.options.failure(
					"unavailable",
					"Browser screenshot bridge is unavailable",
				),
			);
		if (this.pending)
			return Promise.reject(
				this.options.failure("busy", "A browser screenshot is already pending"),
			);
		const request = browserBridgeCaptureRequestSchema.safeParse({
			type: "capture-request",
			id: randomUUID(),
			workspaceId,
			paneId,
		});
		if (!request.success)
			return Promise.reject(
				this.options.failure("invalid", "Invalid browser screenshot scope"),
			);
		return new Promise((resolve, reject) => {
			const pending: PendingCapture = {
				id: request.data.id,
				chunks: [],
				characters: 0,
				cancel: () => {},
				resolve,
				reject,
			};
			this.pending = pending;
			pending.cancel = this.options.schedule(20_000, () => {
				if (this.pending === pending)
					this.disconnect(
						this.options.failure("timeout", "Browser screenshot timed out"),
					);
			});
			try {
				this.options.send(request.data);
			} catch {
				this.disconnect(
					this.options.failure(
						"unavailable",
						"Browser screenshot transport failed",
					),
				);
			}
		});
	}
	receive(
		packet: Extract<
			BrowserBridgePacket,
			{ type: "capture-chunk" | "capture-done" }
		>,
	): void {
		const pending = this.pending;
		if (!pending || packet.id !== pending.id) return;
		if (packet.type === "capture-chunk") {
			if (
				packet.index !== pending.chunks.length ||
				pending.characters + packet.base64.length >
					BROWSER_CAPTURE_MAX_BASE64_CHARS ||
				pending.chunks.at(-1)?.includes("=")
			)
				throw Error("Invalid browser screenshot chunks");
			pending.chunks.push(packet.base64);
			pending.characters += packet.base64.length;
			return;
		}
		if (!packet.ok) {
			this.disconnect(this.options.failure("failed", packet.error.message));
			return;
		}
		if (
			packet.chunks !== pending.chunks.length ||
			packet.base64Chars !== pending.characters
		)
			throw Error("Incomplete browser screenshot");
		const base64 = pending.chunks.join("");
		validateBrowserCaptureBase64(base64);
		this.pending = null;
		pending.cancel();
		pending.resolve({ base64 });
	}
	disconnect(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		if (pending) {
			pending.cancel();
			pending.reject(error);
		}
	}
}
