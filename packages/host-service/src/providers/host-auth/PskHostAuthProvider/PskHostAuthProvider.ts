import { timingSafeEqual } from "node:crypto";
import {
	type BrowserCdpTokenScope,
	verifyBrowserCdpToken,
} from "@superset/shared/browser-cdp-token";
import type { HostAuthProvider } from "../types";

export class PskHostAuthProvider implements HostAuthProvider {
	private readonly secretBuffer: Buffer;

	constructor(secret: string) {
		this.secretBuffer = Buffer.from(secret);
	}

	validate(request: Request): boolean {
		const header = request.headers.get("authorization");
		const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
		return token !== null && this.safeEqual(token);
	}

	validateToken(token: string): boolean {
		return this.safeEqual(token);
	}
	validateBrowserCdpToken(token: string, scope: BrowserCdpTokenScope): boolean {
		return verifyBrowserCdpToken(this.secretBuffer, scope, token);
	}

	private safeEqual(input: string): boolean {
		const inputBuffer = Buffer.from(input);
		if (this.secretBuffer.length !== inputBuffer.length) return false;
		return timingSafeEqual(this.secretBuffer, inputBuffer);
	}
}
