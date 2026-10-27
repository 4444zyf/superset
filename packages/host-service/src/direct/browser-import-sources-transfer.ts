import { randomUUID } from "node:crypto";
import type {
	BrowserBridgeImportSourcesResult,
	BrowserBridgePacket,
} from "@superset/shared/browser-bridge";

interface Target {
	current(): boolean;
	send(packet: BrowserBridgePacket): void;
	invalidate(error: Error): void;
}
type Failure = "unavailable" | "busy" | "timeout" | "invalid" | "failed";
interface Pending {
	id: string;
	resolve(result: BrowserBridgeImportSourcesResult): void;
	reject(error: Error): void;
	cancel(): void;
}
export class BrowserImportSourcesTransfer {
	private pending: Pending | null = null;
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	async read(target: Target): Promise<BrowserBridgeImportSourcesResult> {
		if (!target.current())
			throw this.options.failure(
				"unavailable",
				"Browser login sources are unavailable",
			);
		if (this.pending)
			throw this.options.failure(
				"busy",
				"A browser login source read is already pending",
			);
		return new Promise((resolve, reject) => {
			const pending: Pending = {
				id: randomUUID(),
				resolve,
				reject,
				cancel: () => {},
			};
			this.pending = pending;
			pending.cancel = this.options.schedule(10_000, () => {
				if (this.pending !== pending) return;
				const error = this.options.failure(
					"timeout",
					"Browser login source read timed out",
				);
				target.invalidate(error);
				if (this.pending === pending) this.disconnect(error);
			});
			try {
				target.send({ type: "import-sources-request", id: pending.id });
			} catch {
				const error = this.options.failure(
					"unavailable",
					"Browser login source transport failed",
				);
				target.invalidate(error);
				if (this.pending === pending) this.disconnect(error);
			}
		});
	}
	receive(
		packet: Extract<BrowserBridgePacket, { type: "import-sources-result" }>,
	): void {
		const pending = this.pending;
		if (!pending || packet.id !== pending.id) return;
		this.pending = null;
		pending.cancel();
		if (packet.ok) pending.resolve(packet.result);
		else pending.reject(this.options.failure("failed", packet.error.message));
	}
	disconnect(error: Error): void {
		const pending = this.pending;
		this.pending = null;
		pending?.cancel();
		pending?.reject(error);
	}
}
