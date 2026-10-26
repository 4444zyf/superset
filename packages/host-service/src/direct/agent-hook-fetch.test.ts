import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createDirectAgentHookFetch } from "./agent-hook-fetch";

const hookToken = "a".repeat(64);
const secret = "owned-backend-secret";

function fixture() {
	const app = new Hono();
	const received: Request[] = [];
	app.use("*", async (c, next) => {
		received.push(c.req.raw);
		if (c.req.header("origin")) return c.text("Forbidden origin", 403);
		if (c.req.header("authorization") !== `Bearer ${secret}`)
			return c.text("Unauthorized", 401);
		return next();
	});
	app.post("/trpc/notifications.hook", async (c) =>
		c.json({ received: await c.req.json() }),
	);
	return {
		received,
		fetch: createDirectAgentHookFetch(app.fetch, hookToken, secret),
	};
}

test("the owned callback capability forwards only the original hook with server-side authentication", async () => {
	const f = fixture();
	const body = {
		json: { terminalId: "owned-terminal", eventType: "Attached" },
	};
	const response = await f.fetch(
		new Request(`http://127.0.0.1/agent-hook/${hookToken}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ received: body });
	expect(new URL(f.received[0]!.url).pathname).toBe("/trpc/notifications.hook");
	expect(response.headers.has("authorization")).toBe(false);
});

test("other paths, tokens, methods, query strings and the existing hook retain normal authentication", async () => {
	for (const [path, method] of [
		["/trpc/notifications.hook", "POST"],
		[`/agent-hook/${"b".repeat(64)}`, "POST"],
		[`/agent-hook/${hookToken}/terminal.send`, "POST"],
		[`/agent-hook/${hookToken}?batch=1`, "POST"],
		[`/agent-hook/${hookToken}`, "GET"],
	]) {
		const f = fixture();
		const response = await f.fetch(
			new Request(`http://127.0.0.1${path}`, { method }),
		);
		expect(response.status).toBe(401);
		expect(f.received[0]!.headers.has("authorization")).toBe(false);
	}
});

test("the callback relay preserves the original origin guard", async () => {
	const f = fixture();
	const response = await f.fetch(
		new Request(`http://127.0.0.1/agent-hook/${hookToken}`, {
			method: "POST",
			headers: { origin: "https://unrelated.invalid" },
			body: "{}",
		}),
	);
	expect(response.status).toBe(403);
});
