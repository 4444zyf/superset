import { expect, test } from "bun:test";
import { forwardedTerminalUrl, terminalUrlTarget } from "./terminal-url-target";

test("localhost URLs follow the selected device while public URLs keep their target", () => {
	const url = "http://localhost:3000/preview?q=%E4%B8%AD#fragment";
	expect(terminalUrlTarget(url, true)).toEqual({ kind: "external", url });
	expect(terminalUrlTarget(url, false)).toEqual({
		kind: "forward",
		url,
		port: 3000,
	});
	expect(terminalUrlTarget("https://example.test/a", false)).toEqual({
		kind: "external",
		url: "https://example.test/a",
	});
	expect(terminalUrlTarget("http://127.example.test:3000/", false)).toEqual({
		kind: "external",
		url: "http://127.example.test:3000/",
	});
	for (const raw of [
		"http://LOCALHOST.:3000/",
		"http://127.1:3000/",
		"http://127.0.0.2:3000/",
		"http://[::1]:3000/",
		"http://[::ffff:127.0.0.1]:3000/",
		"http://0.0.0.0:3000/",
	])
		expect(terminalUrlTarget(raw, false)).toMatchObject({
			kind: "forward",
			port: 3000,
		});
});

test("invalid or non-HTTP terminal targets do not become navigation requests", () => {
	for (const raw of [
		"javascript:alert(1)",
		"file:///tmp/file",
		"//localhost:3000",
		"http://localhost:0/",
		"http://localhost:65536/",
		"http://local\nhost:3000/",
		`https://example.test/${"x".repeat(8192)}`,
	])
		expect(terminalUrlTarget(raw, false)).toBeNull();
});

test("forwarding changes only the authority of a loopback target", () => {
	expect(
		forwardedTerminalUrl(
			"https://user:password@localhost:3000/a%2Fb?q=one%20two#fragment",
			"http://127.0.0.1:4000",
		),
	).toBe("https://user:password@127.0.0.1:4000/a%2Fb?q=one%20two#fragment");
	expect(
		forwardedTerminalUrl("https://example.test/a", "http://127.0.0.1:4000"),
	).toBeNull();
	expect(
		forwardedTerminalUrl(
			"http://localhost:3000/a",
			"https://example.test:4000",
		),
	).toBeNull();
});
