import { randomUUID } from "node:crypto";
export interface WindowCloseRequest {
	requestId: string;
	registrationId: string;
	kind: "window" | "quit";
}
export class WindowCloseGate {
	private registration: { owner: number; epoch: number; id: string } | null =
		null;
	private pending: {
		owner: number;
		epoch: number;
		request: WindowCloseRequest;
		promise: Promise<boolean>;
		resolve(value: boolean): void;
	} | null = null;
	register(owner: number, epoch: number, registrationId: string) {
		this.invalidate();
		this.registration = { owner, epoch, id: registrationId };
	}
	unregister(owner: number, epoch: number, registrationId: string) {
		if (
			this.registration?.owner === owner &&
			this.registration.epoch === epoch &&
			this.registration.id === registrationId
		)
			this.invalidate();
	}
	request(
		owner: number,
		epoch: number,
		kind: "window" | "quit",
		send: (request: WindowCloseRequest) => void,
	): Promise<boolean> {
		const registration = this.registration;
		if (!registration) return Promise.resolve(true);
		if (registration.owner !== owner || registration.epoch !== epoch)
			return Promise.resolve(false);
		if (this.pending) return this.pending.promise;
		let resolve!: (value: boolean) => void;
		const promise = new Promise<boolean>((done) => {
			resolve = done;
		});
		const request = {
			requestId: randomUUID(),
			registrationId: registration.id,
			kind,
		};
		this.pending = { owner, epoch, request, promise, resolve };
		try {
			send(request);
		} catch {
			this.invalidate();
		}
		return promise;
	}
	reply(
		owner: number,
		epoch: number,
		input: { requestId: string; registrationId: string; allow: boolean },
	): boolean {
		const pending = this.pending;
		if (
			!pending ||
			pending.owner !== owner ||
			pending.epoch !== epoch ||
			pending.request.requestId !== input.requestId ||
			pending.request.registrationId !== input.registrationId
		)
			return false;
		this.pending = null;
		pending.resolve(input.allow);
		return true;
	}
	invalidate() {
		const pending = this.pending;
		this.pending = null;
		this.registration = null;
		pending?.resolve(false);
	}
}
