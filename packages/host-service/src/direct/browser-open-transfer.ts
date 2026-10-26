import { randomUUID } from "node:crypto";
import {
	browserBridgeOpenRequestSchema,
	type BrowserBridgePacket,
} from "@superset/shared/browser-bridge";
import type {
	BrowserOpenInput,
	PinnedBrowserOpen,
} from "./browser-open-operation";

interface Reservation {
	id: string;
	scopeId: string;
	started: boolean;
	resolve?: (value: { paneId: string; url: string; title: string }) => void;
	reject?: (error: Error) => void;
	cancel?: () => void;
}
interface Target {
	current(): boolean;
	send(packet: BrowserBridgePacket): void;
	invalidate(error: Error): void;
}
type Failure = "unavailable" | "busy" | "timeout" | "invalid" | "failed";

export class BrowserOpenTransfer {
	private reservation: Reservation | null = null;
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	pin(
		input: BrowserOpenInput & {
			scopeId: string;
			projectId: string | null;
			workspaceName: string;
		},
		target: Target,
	): PinnedBrowserOpen {
		if (!target.current())
			throw this.options.failure(
				"unavailable",
				"Browser open bridge is unavailable",
			);
		if (this.reservation)
			throw this.options.failure("busy", "A browser open is already pending");
		const packet = browserBridgeOpenRequestSchema.safeParse({
			type: "open-request",
			id: randomUUID(),
			...input,
		});
		if (!packet.success)
			throw this.options.failure("invalid", "Invalid browser open scope");
		const reservation: Reservation = {
			id: packet.data.id,
			scopeId: packet.data.scopeId,
			started: false,
		};
		this.reservation = reservation;
		const execute: PinnedBrowserOpen = () => {
			if (
				reservation.started ||
				this.reservation !== reservation ||
				!target.current()
			)
				return Promise.reject(
					this.options.failure(
						"unavailable",
						"The pinned browser open is no longer current",
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
						"Browser open acknowledgement timed out",
					);
					target.invalidate(error);
					if (this.reservation === reservation) this.disconnect(error);
				});
				try {
					target.send(packet.data);
				} catch {
					const error = this.options.failure(
						"unavailable",
						"Browser open transport failed",
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
						"The pinned browser open was released",
					),
				);
		};
		return execute;
	}
	receive(packet: Extract<BrowserBridgePacket, { type: "open-result" }>): void {
		const reservation = this.reservation;
		if (
			!reservation ||
			packet.id !== reservation.id ||
			packet.scopeId !== reservation.scopeId
		)
			return;
		if (!reservation.started) throw Error("Browser open was not dispatched");
		if (!packet.ok) {
			this.disconnect(this.options.failure("failed", packet.error.message));
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
