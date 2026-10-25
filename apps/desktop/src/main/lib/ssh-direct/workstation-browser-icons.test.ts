import { expect, test } from "bun:test";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import {
	WorkstationBrowserIcons,
	MAX_BROWSER_ICON_BYTES,
} from "./workstation-browser-icons";

const pane: WorkstationBrowserPane = {
	connectionId: "connection",
	generation: 1,
	workspaceId: "workspace",
	paneId: "pane",
	registrationId: "registration",
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>';
const image = () =>
	new Response(svg, { headers: { "content-type": "image/svg+xml" } });

function fixture() {
	let current = true,
		allowed = true;
	const requests: string[] = [];
	let fetchImage = async (_url: string) => image();
	const icons = new WorkstationBrowserIcons({
		resolve: async (_owner, _pane, candidate) =>
			allowed
				? {
						key: candidate,
						url: candidate,
						current: () => current,
						resolveRedirect: async (url) => (current ? url : null),
						fetch: async (url) => {
							requests.push(url);
							return fetchImage(url);
						},
					}
				: null,
	});
	return {
		icons,
		requests,
		setFetch: (next: typeof fetchImage) => {
			fetchImage = next;
		},
		invalidate: () => {
			current = false;
		},
		deny: () => {
			allowed = false;
		},
	};
}

test("only a resolved registered icon becomes an image data URL and cache access rechecks ownership", async () => {
	const f = fixture();
	const result = await f.icons.get(1, pane, "https://example.com/icon.svg");
	expect(result?.dataUrl).toBe(
		`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
	);
	expect(await f.icons.get(1, pane, "https://example.com/icon.svg")).toEqual(
		result,
	);
	expect(f.requests).toHaveLength(1);
	f.deny();
	expect(await f.icons.get(1, pane, "https://example.com/icon.svg")).toBeNull();
});

test("duplicate pending icon requests share the fetch and stale ownership never returns its bytes", async () => {
	const f = fixture(),
		pending = Promise.withResolvers<Response>();
	f.setFetch(() => pending.promise);
	const first = f.icons.get(1, pane, "https://example.com/icon.svg"),
		second = f.icons.get(1, pane, "https://example.com/icon.svg");
	await Promise.resolve();
	f.invalidate();
	pending.resolve(image());
	expect(await first).toBeNull();
	expect(await second).toBeNull();
	expect(f.requests).toHaveLength(1);
});

test("oversized and non-image responses return no data URL", async () => {
	const f = fixture();
	f.setFetch(
		async () =>
			new Response("<html>private text</html>", {
				headers: { "content-type": "text/html" },
			}),
	);
	expect(await f.icons.get(1, pane, "https://example.com/html")).toBeNull();
	f.setFetch(
		async () =>
			new Response(new Uint8Array(MAX_BROWSER_ICON_BYTES + 1), {
				headers: { "content-type": "image/png" },
			}),
	);
	expect(await f.icons.get(1, pane, "https://example.com/large")).toBeNull();
});

test("redirects resolve within the captured scope and have a bounded hop count", async () => {
	const f = fixture();
	f.setFetch(async (url) =>
		url.endsWith("/start")
			? new Response(null, { status: 302, headers: { location: "/icon.svg" } })
			: image(),
	);
	expect(
		(await f.icons.get(1, pane, "https://example.com/start"))?.dataUrl,
	).toContain("data:image/svg+xml;base64,");
	expect(f.requests).toEqual([
		"https://example.com/start",
		"https://example.com/icon.svg",
	]);
	const loop = fixture();
	loop.setFetch(
		async () =>
			new Response(null, { status: 302, headers: { location: "/loop" } }),
	);
	expect(await loop.icons.get(1, pane, "https://example.com/loop")).toBeNull();
	expect(loop.requests.length).toBeLessThanOrEqual(4);
});

test("an oversized declared image cancels its body before reading it", async () => {
	const f = fixture();
	let canceled = false;
	f.setFetch(
		async () =>
			new Response(
				new ReadableStream({
					cancel() {
						canceled = true;
					},
				}),
				{
					headers: {
						"content-type": "image/png",
						"content-length": String(MAX_BROWSER_ICON_BYTES + 1),
					},
				},
			),
	);
	expect(
		await f.icons.get(1, pane, "https://example.com/large.png"),
	).toBeNull();
	expect(canceled).toBe(true);
});
