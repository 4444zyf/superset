export type TerminalUrlTarget =
	| { kind: "external"; url: string }
	| { kind: "forward"; url: string; port: number };

export function terminalUrlTarget(
	raw: string,
	localDevice: boolean,
): TerminalUrlTarget | null {
	if (
		!raw ||
		raw.length > 8192 ||
		[...raw].some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		)
	)
		return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
		if (port < 1 || port > 65535) return null;
		const hostname = url.hostname.replace(/\.$/, "");
		const loopback =
			/^127(?:\.\d{1,3}){3}$/.test(hostname) ||
			/^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(hostname) ||
			["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"].includes(hostname);
		return !localDevice && loopback
			? { kind: "forward", url: url.href, port }
			: { kind: "external", url: url.href };
	} catch {
		return null;
	}
}

export function forwardedTerminalUrl(
	raw: string,
	forward: string,
): string | null {
	const source = terminalUrlTarget(raw, false);
	const destination = terminalUrlTarget(forward, false);
	if (source?.kind !== "forward" || destination?.kind !== "forward")
		return null;
	const url = new URL(source.url);
	url.host = new URL(destination.url).host;
	return url.href;
}
