import { randomUUID } from "node:crypto";
import {
	browserBridgeNavigateRequestSchema,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import type {
	BrowserNavigationInput,
	PinnedBrowserNavigation,
} from "./browser-navigation-operation";

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

export class BrowserNavigationTransfer {
	private reservation: Reservation | null = null;
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	pin(input: BrowserNavigationInput, target: Target): PinnedBrowserNavigation {
		if (!target.current())
			throw this.options.failure(
				"unavailable",
				"Browser navigation bridge is unavailable",
			);
		if (this.reservation)
			throw this.options.failure(
				"busy",
				"A browser navigation is already pending",
			);
		const packet = browserBridgeNavigateRequestSchema.safeParse({
			type: "navigate-request",
			id: randomUUID(),
			...input,
		});
		if (!packet.success)
			throw this.options.failure("invalid", "Invalid browser navigation scope");
		const reservation: Reservation = { id: packet.data.id, started: false };
		this.reservation = reservation;
		const execute: PinnedBrowserNavigation = () => {
			if (
				reservation.started ||
				this.reservation !== reservation ||
				!target.current()
			)
				return Promise.reject(
					this.options.failure(
						"unavailable",
						"The pinned browser navigation is no longer current",
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
						"Browser navigation acknowledgement timed out",
					);
					target.invalidate(error);
					if (this.reservation === reservation) this.disconnect(error);
				});
				try {
					target.send(packet.data);
				} catch {
					const error = this.options.failure(
						"unavailable",
						"Browser navigation transport failed",
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
						"The pinned browser navigation was released",
					),
				);
		};
		return execute;
	}
	receive(
		packet: Extract<BrowserBridgePacket, { type: "navigate-result" }>,
	): void {
		const reservation = this.reservation;
		if (!reservation || packet.id !== reservation.id) return;
		if (!reservation.started)
			throw Error("Browser navigation was not dispatched");
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
