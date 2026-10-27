import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const BROWSER_CDP_TOKEN_TTL_MS = 5 * 60 * 1000;
export interface BrowserCdpTokenScope {
	backendId: string;
	namespaceId: string;
	instanceId: string;
	workspaceId: string;
	paneId: string;
}
type Key = string | Uint8Array;
function scopeValues(scope: BrowserCdpTokenScope): string[] {
	const values = [
		scope.backendId,
		scope.namespaceId,
		scope.instanceId,
		scope.workspaceId,
		scope.paneId,
	];
	if (
		values.some(
			(value, index) =>
				typeof value !== "string" ||
				value.length < 1 ||
				value.length > (index < 3 ? 128 : 256),
		)
	)
		throw Error("Invalid browser CDP token scope");
	return values;
}
function signature(
	key: Key,
	scope: BrowserCdpTokenScope,
	expiresAt: number,
	nonce: string,
): Buffer {
	return createHmac("sha256", key)
		.update(
			JSON.stringify([
				"direct-browser-cdp-v1",
				...scopeValues(scope),
				expiresAt,
				nonce,
			]),
		)
		.digest();
}

export function mintBrowserCdpToken(
	key: Key,
	scope: BrowserCdpTokenScope,
	now = Date.now(),
): string {
	const expiresAt = now + BROWSER_CDP_TOKEN_TTL_MS;
	if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt))
		throw Error("Invalid browser CDP token time");
	const nonce = randomBytes(16).toString("hex");
	return `cdp1.${expiresAt}.${nonce}.${signature(key, scope, expiresAt, nonce).toString("hex")}`;
}

export function verifyBrowserCdpToken(
	key: Key,
	scope: BrowserCdpTokenScope,
	token: string,
	now = Date.now(),
): boolean {
	try {
		if (
			typeof token !== "string" ||
			token.length > 256 ||
			!Number.isSafeInteger(now)
		)
			return false;
		const match = /^cdp1\.([0-9]{1,16})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(
			token,
		);
		if (!match) return false;
		const expiresAt = Number(match[1]);
		if (
			!Number.isSafeInteger(expiresAt) ||
			expiresAt <= now ||
			expiresAt > now + BROWSER_CDP_TOKEN_TTL_MS
		)
			return false;
		const nonce = match[2],
			provided = match[3];
		if (!nonce || !provided) return false;
		return timingSafeEqual(
			Buffer.from(provided, "hex"),
			signature(key, scope, expiresAt, nonce),
		);
	} catch {
		return false;
	}
}
