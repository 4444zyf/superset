import { expect, test } from "bun:test";
import { WindowCloseGate } from "./window-close-gate";

test("close and quit share one request and only the current owner registration can resolve it", async () => {
	const gate = new WindowCloseGate();
	gate.register(7, 3, "registered");
	expect(
		await gate.request(8, 3, "window", () => {
			throw new Error("Wrong owner notified");
		}),
	).toBe(false);
	const sent: { requestId: string; registrationId: string; kind: string }[] =
		[];
	const pending = gate.request(7, 3, "window", (request) => sent.push(request));
	const quit = gate.request(7, 3, "quit", (request) => sent.push(request));
	expect(quit).toBe(pending);
	expect(sent).toHaveLength(1);
	const request = sent[0]!;
	expect(gate.reply(8, 3, { ...request, allow: true })).toBe(false);
	expect(gate.reply(7, 2, { ...request, allow: true })).toBe(false);
	expect(
		gate.reply(7, 3, { ...request, registrationId: "old", allow: true }),
	).toBe(false);
	expect(gate.reply(7, 3, { ...request, allow: false })).toBe(true);
	expect(await pending).toBe(false);
	expect(await quit).toBe(false);
	expect(gate.reply(7, 3, { ...request, allow: true })).toBe(false);
});

test("unregistering or replacing a renderer cancels its pending close rather than approving a new window", async () => {
	const gate = new WindowCloseGate();
	gate.register(7, 3, "first");
	const sent: unknown[] = [];
	const pending = gate.request(7, 3, "window", (request) => sent.push(request));
	gate.register(7, 4, "second");
	expect(await pending).toBe(false);
	gate.unregister(7, 3, "first");
	let current:
		| { requestId: string; registrationId: string; kind: string }
		| undefined;
	const next = gate.request(7, 4, "quit", (request) => {
		current = request;
	});
	expect(current).toBeDefined();
	gate.invalidate();
	expect(await next).toBe(false);
});
