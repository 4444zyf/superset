import { expect, test } from "bun:test";
import { mintBrowserCdpToken } from "@superset/shared/browser-cdp-token";
import { Hono } from "hono";
import { PskHostAuthProvider } from "../providers/host-auth/PskHostAuthProvider/PskHostAuthProvider";
import { registerDirectRequestAuth } from "./request-auth";

const key = "a".repeat(64),
	identity = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	},
	scope = { ...identity, workspaceId: "workspace", paneId: "pane" };
function fixture() {
	const app = new Hono(),
		auth = new PskHostAuthProvider(key);
	let frozen = false;
	registerDirectRequestAuth({
		app,
		auth,
		identity,
		allowedOrigins: () => ["http://owned-renderer.invalid"],
		isFrozen: () => frozen,
	});
	app.all("*", (c) => c.text("reached"));
	return {
		app,
		freeze: () => {
			frozen = true;
		},
	};
}
test("the real direct ingress accepts scoped CDP upgrades before the second websocket auth layer", async () => {
	const f = fixture(),
		token = mintBrowserCdpToken(key, scope),
		url = `http://127.0.0.1/direct/browser/pane/cdp-v1?workspaceId=workspace&instanceId=instance&token=${token}`;
	expect(
		(await f.app.request(url, { headers: { Upgrade: "websocket" } })).status,
	).toBe(200);
	expect((await f.app.request(url)).status).toBe(401);
	expect(
		(
			await f.app.request(url.replace("/browser/pane/", "/browser/foreign/"), {
				headers: { Upgrade: "websocket" },
			})
		).status,
	).toBe(401);
});
test("the original bearer and upgrade-only query PSK behavior is retained", async () => {
	const f = fixture();
	expect(
		(
			await f.app.request("http://127.0.0.1/direct/describe", {
				headers: { Authorization: `Bearer ${key}` },
			})
		).status,
	).toBe(200);
	const url = `http://127.0.0.1/direct/describe?token=${key}`;
	expect((await f.app.request(url)).status).toBe(401);
	expect(
		(await f.app.request(url, { headers: { Upgrade: "websocket" } })).status,
	).toBe(200);
});
test("original origin, preflight, tRPC handoff and maintenance decisions remain in order", async () => {
	const f = fixture();
	expect(
		(
			await f.app.request("http://127.0.0.1/direct/describe", {
				headers: {
					Origin: "http://foreign.invalid",
					Authorization: `Bearer ${key}`,
				},
			})
		).status,
	).toBe(403);
	expect(
		(
			await f.app.request("http://127.0.0.1/direct/describe", {
				method: "OPTIONS",
				headers: { Origin: "http://owned-renderer.invalid" },
			})
		).status,
	).toBe(200);
	expect(
		(await f.app.request("http://127.0.0.1/trpc/original-handler")).status,
	).toBe(200);
	f.freeze();
	expect(
		(
			await f.app.request("http://127.0.0.1/events", {
				headers: { Authorization: `Bearer ${key}` },
			})
		).status,
	).toBe(503);
	expect(
		(
			await f.app.request("http://127.0.0.1/direct/describe", {
				headers: { Authorization: `Bearer ${key}` },
			})
		).status,
	).toBe(200);
});
