import { expect, test } from "bun:test";
import {
	BROWSER_CDP_TOKEN_TTL_MS,
	mintBrowserCdpToken,
	verifyBrowserCdpToken,
} from "./browser-cdp-token";

const key = "a".repeat(64),
	scope = {
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
		workspaceId: "workspace",
		paneId: "pane-中文",
	},
	now = 1_700_000_000_000;
test("a CDP endpoint credential is scoped and does not contain the namespace key", () => {
	const token = mintBrowserCdpToken(key, scope, now);
	expect(token.includes(key)).toBe(false);
	expect(verifyBrowserCdpToken(key, scope, token, now)).toBe(true);
	expect(verifyBrowserCdpToken("b".repeat(64), scope, token, now)).toBe(false);
});
test("each backend, namespace, instance, workspace and pane is bound into the CDP credential", () => {
	const token = mintBrowserCdpToken(key, scope, now);
	for (const field of [
		"backendId",
		"namespaceId",
		"instanceId",
		"workspaceId",
		"paneId",
	] as const)
		expect(
			verifyBrowserCdpToken(key, { ...scope, [field]: "foreign" }, token, now),
		).toBe(false);
});
test("CDP credentials expire at the exact deadline without waiting on a real timer", () => {
	const token = mintBrowserCdpToken(key, scope, now);
	expect(
		verifyBrowserCdpToken(
			key,
			scope,
			token,
			now + BROWSER_CDP_TOKEN_TTL_MS - 1,
		),
	).toBe(true);
	expect(
		verifyBrowserCdpToken(key, scope, token, now + BROWSER_CDP_TOKEN_TTL_MS),
	).toBe(false);
	expect(verifyBrowserCdpToken(key, scope, token, now - 1)).toBe(false);
});
test("tampered, oversized or malformed scoped credentials never authenticate", () => {
	const token = mintBrowserCdpToken(key, scope, now);
	for (const value of [
		"",
		key,
		`${token}x`,
		token.replace(/^cdp1/, "other"),
		"x".repeat(1024),
		"cdp1.NaN.nonce.signature",
	])
		expect(verifyBrowserCdpToken(key, scope, value, now)).toBe(false);
	const parts = token.split(".");
	parts[1] = String(now + BROWSER_CDP_TOKEN_TTL_MS * 2);
	expect(verifyBrowserCdpToken(key, scope, parts.join("."), now)).toBe(false);
});
test("separate explicit endpoint requests receive distinct nonces", () => {
	const a = mintBrowserCdpToken(key, scope, now),
		b = mintBrowserCdpToken(key, scope, now);
	expect(a).not.toBe(b);
	expect(verifyBrowserCdpToken(key, scope, a, now)).toBe(true);
	expect(verifyBrowserCdpToken(key, scope, b, now)).toBe(true);
});
