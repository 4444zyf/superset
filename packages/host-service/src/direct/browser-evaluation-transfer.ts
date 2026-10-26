import { randomUUID } from "node:crypto";
import {
	type BrowserBridgePacket,
	browserBridgeEvaluateRequestSchema,
} from "@superset/shared/browser-bridge";
import type {
	BrowserEvaluationInput,
	PinnedBrowserEvaluation,
} from "./browser-evaluation-operation";

interface Reservation {
	id: string;
	started: boolean;
	resolve?: (value: { result: unknown }) => void;
	reject?: (error: Error) => void;
	cancel?: () => void;
}
interface Target {
	current(): boolean;
	send(packet: BrowserBridgePacket): void;
	invalidate(error: Error): void;
}
type Failure = "unavailable" | "busy" | "timeout" | "invalid" | "failed";

export class BrowserEvaluationTransfer {
	private reservation: Reservation | null = null;
	constructor(
		private readonly options: {
			schedule(milliseconds: number, callback: () => void): () => void;
			failure(kind: Failure, message: string): Error;
		},
	) {}
	pin(input: BrowserEvaluationInput, target: Target): PinnedBrowserEvaluation {
		if (!target.current())
			throw this.options.failure(
				"unavailable",
				"Browser evaluation bridge is unavailable",
			);
		if (this.reservation)
			throw this.options.failure(
				"busy",
				"A browser evaluation is already pending",
			);
		const packet = browserBridgeEvaluateRequestSchema.safeParse({
			type: "evaluate-request",
			id: randomUUID(),
			...input,
		});
		if (!packet.success)
			throw this.options.failure("invalid", "Invalid browser evaluation scope");
		const reservation: Reservation = { id: packet.data.id, started: false };
		this.reservation = reservation;
		const execute: PinnedBrowserEvaluation = () => {
			if (
				reservation.started ||
				this.reservation !== reservation ||
				!target.current()
			)
				return Promise.reject(
					this.options.failure(
						"unavailable",
						"The pinned browser evaluation is no longer current",
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
						"Browser evaluation acknowledgement timed out",
					);
					target.invalidate(error);
					if (this.reservation === reservation) this.disconnect(error);
				});
				try {
					target.send(packet.data);
				} catch {
					const error = this.options.failure(
						"unavailable",
						"Browser evaluation transport failed",
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
						"The pinned browser evaluation was released",
					),
				);
		};
		return execute;
	}
	receive(
		packet: Extract<BrowserBridgePacket, { type: "evaluate-result" }>,
	): void {
		const reservation = this.reservation;
		if (!reservation || packet.id !== reservation.id) return;
		if (!reservation.started)
			throw Error("Browser evaluation was not dispatched");
		if (!packet.ok) {
			this.disconnect(this.options.failure("failed", packet.error.message));
			return;
		}
		this.reservation = null;
		reservation.cancel?.();
		reservation.resolve?.({ result: packet.result });
	}
	disconnect(error: Error): void {
		const reservation = this.reservation;
		this.reservation = null;
		reservation?.cancel?.();
		reservation?.reject?.(error);
	}
}
