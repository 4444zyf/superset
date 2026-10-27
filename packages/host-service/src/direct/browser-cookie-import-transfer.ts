import { randomUUID } from "node:crypto";
import {
	BROWSER_COOKIE_IMPORT_ACK_TIMEOUT_MS,
	type BrowserBridgeCookieImportResult,
	type BrowserBridgePacket,
	browserBridgeCookieImportRequestSchema,
} from "@superset/shared/browser-bridge";
import type {
	BrowserCookieImportInput,
	PinnedBrowserCookieImport,
} from "./browser-cookie-import-operation";

interface Reservation {
	id: string;
	started: boolean;
	resolve?: (value: BrowserBridgeCookieImportResult) => void;
	reject?: (error: Error) => void;
	cancel?: () => void;
}
interface Target {
	current(): boolean;
	send(packet: BrowserBridgePacket): void;
	invalidate(error: Error): void;
}
type Failure = "unavailable" | "busy" | "timeout" | "invalid" | "failed";

export class BrowserCookieImportTransfer {
	private reservation: Reservation | null = null;
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	pin(
		input: BrowserCookieImportInput,
		target: Target,
	): PinnedBrowserCookieImport {
		if (!target.current())
			throw this.options.failure(
				"unavailable",
				"Browser cookie import bridge is unavailable",
			);
		if (this.reservation)
			throw this.options.failure(
				"busy",
				"A browser cookie import is already pending",
			);
		const packet = browserBridgeCookieImportRequestSchema.safeParse({
			type: "import-cookies-request",
			id: randomUUID(),
			...input,
		});
		if (!packet.success)
			throw this.options.failure(
				"invalid",
				"Invalid browser cookie import scope",
			);
		const reservation: Reservation = { id: packet.data.id, started: false };
		this.reservation = reservation;
		const execute: PinnedBrowserCookieImport = () => {
			if (
				reservation.started ||
				this.reservation !== reservation ||
				!target.current()
			)
				return Promise.reject(
					this.options.failure(
						"unavailable",
						"The pinned browser cookie import is no longer current",
					),
				);
			reservation.started = true;
			return new Promise((resolve, reject) => {
				reservation.resolve = resolve;
				reservation.reject = reject;
				reservation.cancel = this.options.schedule(
					BROWSER_COOKIE_IMPORT_ACK_TIMEOUT_MS,
					() => {
						if (this.reservation !== reservation) return;
						const error = this.options.failure(
							"timeout",
							"Browser cookie import acknowledgement timed out",
						);
						target.invalidate(error);
						if (this.reservation === reservation) this.disconnect(error);
					},
				);
				try {
					target.send(packet.data);
				} catch {
					const error = this.options.failure(
						"unavailable",
						"Browser cookie import transport failed",
					);
					target.invalidate(error);
					if (this.reservation === reservation) this.disconnect(error);
				}
			});
		};
		execute.release = () => {
			if (this.reservation === reservation)
				this.disconnect(
					this.options.failure(
						"unavailable",
						"The pinned browser cookie import was released",
					),
				);
		};
		return execute;
	}
	receive(
		packet: Extract<BrowserBridgePacket, { type: "import-cookies-result" }>,
	): void {
		const reservation = this.reservation;
		if (!reservation || packet.id !== reservation.id) return;
		if (!reservation.started)
			throw Error("Browser cookie import was not dispatched");
		if (!packet.ok) {
			this.disconnect(
				this.options.failure(
					packet.error.kind ?? "failed",
					packet.error.message,
				),
			);
			return;
		}
		this.reservation = null;
		reservation.cancel?.();
		reservation.resolve?.(packet.result);
	}
	disconnect(error: Error): void {
		const reservation = this.reservation;
		this.reservation = null;
		reservation?.cancel?.();
		reservation?.reject?.(error);
	}
}
