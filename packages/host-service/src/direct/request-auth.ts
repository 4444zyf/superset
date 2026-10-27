import type { BrowserCdpTokenScope } from "@superset/shared/browser-cdp-token";
import type { Hono } from "hono";
import type { HostAuthProvider } from "../providers/host-auth";
import { authorizeDirectBrowserCdpUpgrade } from "./browser-cdp-auth";

export function registerDirectRequestAuth({
	app,
	auth,
	identity,
	allowedOrigins,
	isFrozen,
}: {
	app: Hono;
	auth: HostAuthProvider;
	identity:
		| Pick<BrowserCdpTokenScope, "backendId" | "namespaceId" | "instanceId">
		| undefined;
	allowedOrigins(): string | string[];
	isFrozen(): boolean;
}): void {
	app.use("*", async (context, next) => {
		const origin = context.req.header("origin"),
			origins = allowedOrigins();
		const allowed = Array.isArray(origins) ? origins : [origins];
		if (origin && !allowed.includes(origin))
			return context.json({ error: "Forbidden origin" }, 403);
		if (context.req.method === "OPTIONS" && origin && allowed.includes(origin))
			return next();
		if (context.req.path.startsWith("/trpc/")) return next();
		const isWebSocket =
			context.req.header("upgrade")?.toLowerCase() === "websocket";
		const token = isWebSocket ? context.req.query("token") : undefined;
		if (
			!(await auth.validate(context.req.raw)) &&
			!(token && (await auth.validateToken(token))) &&
			!(await authorizeDirectBrowserCdpUpgrade(context.req.raw, identity, auth))
		) {
			return context.json({ error: "Unauthorized" }, 401);
		}
		if (isFrozen() && !context.req.path.startsWith("/direct/"))
			return context.json(
				{ error: "The backend is frozen for maintenance" },
				503,
			);
		return next();
	});
}
