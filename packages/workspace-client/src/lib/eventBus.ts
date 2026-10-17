import { DIAL_TIMEOUT_MS } from "@superset/shared/tunnel-protocol";
import { type EventBusHandle, getEventBusForTransport } from "./eventBusCore";
import { createRelaySocket } from "./relaySocket";

export * from "./eventBusCore";

const RECONNECT_BASE_MS = 1_000;
// Keep recovery responsive without a second timer forcing reconnect(). A
// forced retry can abort a healthy relay handshake, which may take up to
// DIAL_TIMEOUT_MS. Backoff runs only after an attempt finishes or fails.
const RECONNECT_MAX_MS = 5_000;
// Definitive access denial (preflight 403): the relay will keep saying no, so
// exponential 1-30s retries just hammer it. Poll slowly instead of stopping
// outright so access granted later (host sharing) is picked up eventually.
const ACCESS_DENIED_RETRY_MS = 5 * 60_000;
// Host not connected to the relay (preflight 503). The roster holds a socket
// open for every host so its state is presence, which makes this the cadence
// at which an offline host is re-probed: one cheap relay request per window.
const HOST_OFFLINE_RETRY_MS = 30_000;

export function getEventBus(
	hostUrl: string,
	getWsToken: () => string | null,
	getUrlParams?: () => Record<string, string> | null,
): EventBusHandle {
	return getEventBusForTransport(hostUrl, (onProbe) =>
		createRelaySocket({
			buildUrl: () => {
				const url = new URL(`${hostUrl.replace(/\/$/, "")}/events`);
				for (const [key, value] of Object.entries(getUrlParams?.() ?? {}))
					url.searchParams.set(key, value);
				return url.toString();
			},
			getToken: getWsToken,
			accessDeniedRetryMs: ACCESS_DENIED_RETRY_MS,
			hostOfflineRetryMs: HOST_OFFLINE_RETRY_MS,
			minReconnectionDelay: RECONNECT_BASE_MS,
			maxReconnectionDelay: RECONNECT_MAX_MS,
			connectionTimeout: DIAL_TIMEOUT_MS + 2_000,
			maxEnqueuedMessages: 0,
			onProbe,
		}),
	);
}
