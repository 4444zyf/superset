import type { BrowserCdpTokenScope } from "@superset/shared/browser-cdp-token";
import type { HostAuthProvider } from "../providers/host-auth";

export async function authorizeDirectBrowserCdpUpgrade(
	request: Request,
	identity:
		| Pick<BrowserCdpTokenScope, "backendId" | "namespaceId" | "instanceId">
		| undefined,
	auth: HostAuthProvider,
): Promise<boolean> {
	if (
		!identity ||
		!auth.validateBrowserCdpToken ||
		request.method !== "GET" ||
		request.headers.get("upgrade")?.toLowerCase() !== "websocket"
	)
		return false;
	try {
		const url = new URL(request.url),
			match = /^\/direct\/browser\/([^/]+)\/cdp-v1$/.exec(url.pathname),
			workspaceId = url.searchParams.get("workspaceId"),
			instanceId = url.searchParams.get("instanceId"),
			token = url.searchParams.get("token");
		if (
			!match?.[1] ||
			!workspaceId ||
			!token ||
			instanceId !== identity.instanceId
		)
			return false;
		return (
			(await auth.validateBrowserCdpToken(token, {
				...identity,
				workspaceId,
				paneId: decodeURIComponent(match[1]),
			})) === true
		);
	} catch {
		return false;
	}
}
