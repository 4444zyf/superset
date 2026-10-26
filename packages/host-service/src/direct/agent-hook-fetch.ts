import { timingSafeEqual } from "node:crypto";

export function createDirectAgentHookFetch(
	fetch: (request: Request) => Response | Promise<Response>,
	hookToken: string,
	backendSecret: string,
): (request: Request) => Response | Promise<Response> {
	const hookPath = Buffer.from(`/agent-hook/${hookToken}`);
	return (request) => {
		const url = new URL(request.url),
			path = Buffer.from(url.pathname);
		if (
			request.method !== "POST" ||
			url.search ||
			path.length !== hookPath.length ||
			!timingSafeEqual(path, hookPath)
		)
			return fetch(request);
		url.pathname = "/trpc/notifications.hook";
		const headers = new Headers(request.headers);
		headers.set("authorization", `Bearer ${backendSecret}`);
		const init = {
			method: "POST",
			headers,
			body: request.body,
			duplex: "half" as const,
		};
		return fetch(new Request(url.href, init));
	};
}
