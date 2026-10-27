import { expect, test } from "bun:test";
import { mintBrowserCdpToken } from "@superset/shared/browser-cdp-token";
import { PskHostAuthProvider } from "../providers/host-auth/PskHostAuthProvider/PskHostAuthProvider";
import { authorizeDirectBrowserCdpUpgrade } from "./browser-cdp-auth";

const key = "a".repeat(64),
	identity = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	},
	scope = { ...identity, workspaceId: "workspace", paneId: "pane-中文" };
function request(
	token: string,
	path = "/direct/browser/pane-%E4%B8%AD%E6%96%87/cdp-v1",
	workspaceId = "workspace",
	instanceId = "instance",
	upgrade = true,
	method = "GET",
) {
	const url = new URL(path, "http://127.0.0.1:1234");
	url.searchParams.set("workspaceId", workspaceId);
	url.searchParams.set("instanceId", instanceId);
	url.searchParams.set("token", token);
	return new Request(url.href, {
		method,
		headers: upgrade ? { Upgrade: "websocket" } : {},
	});
}
test("a scoped CDP upgrade authenticates only its exact instance and target", async () => {
	const auth = new PskHostAuthProvider(key),
		token = mintBrowserCdpToken(key, scope);
	expect(
		await authorizeDirectBrowserCdpUpgrade(request(token), identity, auth),
	).toBe(true);
	for (const target of [
		{ backendId: "foreign" },
		{ namespaceId: "foreign" },
		{ instanceId: "foreign" },
	])
		expect(
			await authorizeDirectBrowserCdpUpgrade(
				request(token),
				{ ...identity, ...target },
				auth,
			),
		).toBe(false);
	expect(
		await authorizeDirectBrowserCdpUpgrade(
			request(token, undefined, "foreign"),
			identity,
			auth,
		),
	).toBe(false);
	expect(
		await authorizeDirectBrowserCdpUpgrade(
			request(token, "/direct/browser/foreign/cdp-v1"),
			identity,
			auth,
		),
	).toBe(false);
});
test("a scoped endpoint token is never a namespace PSK or a credential for other routes", async () => {
	const auth = new PskHostAuthProvider(key),
		token = mintBrowserCdpToken(key, scope);
	expect(auth.validateToken(token)).toBe(false);
	expect(
		auth.validate(
			new Request("http://owned.invalid/trpc/direct.describe", {
				headers: { Authorization: `Bearer ${token}` },
			}),
		),
	).toBe(false);
	for (const path of [
		"/direct/describe",
		"/direct/browser-read/v1",
		"/terminal/session",
		"/events",
		"/direct/browser/pane-%E4%B8%AD%E6%96%87/cdp-v1/extra",
	])
		expect(
			await authorizeDirectBrowserCdpUpgrade(
				request(token, path),
				identity,
				auth,
			),
		).toBe(false);
});
test("HTTP requests, missing scope and malformed credentials cannot use scoped CDP authorization", async () => {
	const auth = new PskHostAuthProvider(key),
		token = mintBrowserCdpToken(key, scope);
	expect(
		await authorizeDirectBrowserCdpUpgrade(
			request(token, undefined, undefined, undefined, false),
			identity,
			auth,
		),
	).toBe(false);
	expect(
		await authorizeDirectBrowserCdpUpgrade(
			request(token, undefined, undefined, undefined, true, "POST"),
			identity,
			auth,
		),
	).toBe(false);
	expect(
		await authorizeDirectBrowserCdpUpgrade(
			request(token, undefined, "", ""),
			identity,
			auth,
		),
	).toBe(false);
	expect(
		await authorizeDirectBrowserCdpUpgrade(request("bad"), identity, auth),
	).toBe(false);
});
test("providers without the optional scoped verifier retain their original authentication contract", async () => {
	const token = mintBrowserCdpToken(key, scope),
		old = { validate: () => false, validateToken: () => false };
	expect(
		await authorizeDirectBrowserCdpUpgrade(request(token), identity, old),
	).toBe(false);
});
