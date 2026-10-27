import { randomUUID } from "node:crypto";
import {
	type BrowserBridgePacket,
	browserBridgeReloadRequestSchema,
} from "@superset/shared/browser-bridge";
import type {
	BrowserReloadInput,
	PinnedBrowserReload,
} from "./browser-reload-operation";

interface Reservation {
	id: string;
	started: boolean;
	resolve?: (value: { ok: true }) => void;
	reject?: (error: Error) => void;
	cancel?: () => void;
}
interface Target {
	current(): boolean;
	send(packet: BrowserBridgePacket): void;
	invalidate(error: Error): void;
}
type Failure = "unavailable" | "busy" | "timeout" | "invalid" | "failed";

export class BrowserReloadTransfer {
	private reservation: Reservation | null = null;
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	pin(input: BrowserReloadInput, target: Target): PinnedBrowserReload {
		if (!target.current())
			throw this.options.failure(
				"unavailable",
				"Browser reload bridge is unavailable",
			);
		if (this.reservation)
			throw this.options.failure("busy", "A browser reload is already pending");
		const packet = browserBridgeReloadRequestSchema.safeParse({
			type: "reload-request",
			id: randomUUID(),
			...input,
		});
		if (!packet.success)
			throw this.options.failure("invalid", "Invalid browser reload scope");
		const reservation: Reservation = { id: packet.data.id, started: false };
		this.reservation = reservation;
		const execute: PinnedBrowserReload = () => {
			if (
				reservation.started ||
				this.reservation !== reservation ||
				!target.current()
			)
				return Promise.reject(
					this.options.failure(
						"unavailable",
						"The pinned browser reload is no longer current",
					),
				);
			reservation.started = true;
			return new Promise((resolve, reject) => {
				reservation.resolve = resolve;
				reservation.reject = reject;
				reservation.cancel = this.options.schedule(15_000, () => {
					if (this.reservation !== reservation) return;
					const error = this.options.failure(
						"timeout",
						"Browser reload acknowledgement timed out",
					);
					target.invalidate(error);
					if (this.reservation === reservation) this.disconnect(error);
				});
				try {
					target.send(packet.data);
				} catch {
					const error = this.options.failure(
						"unavailable",
						"Browser reload transport failed",
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
						"The pinned browser reload was released",
					),
				);
		};
		return execute;
	}
	receive(
		packet: Extract<BrowserBridgePacket, { type: "reload-result" }>,
	): void {
		const reservation = this.reservation;
		if (!reservation || packet.id !== reservation.id) return;
		if (!reservation.started) throw Error("Browser reload was not dispatched");
		if (!packet.ok) {
			this.disconnect(this.options.failure("failed", packet.error.message));
			return;
		}
		this.reservation = null;
		reservation.cancel?.();
		reservation.resolve?.({ ok: true });
	}
	disconnect(error: Error): void {
		const reservation = this.reservation;
		this.reservation = null;
		reservation?.cancel?.();
		reservation?.reject?.(error);
	}
}
