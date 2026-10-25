import { expect, test } from "bun:test";
import { terminalUrlLinks } from "./terminal-url-links";

test("the live URL action can open a pane or tab without recreating the terminal handler", () => {
	const opened: unknown[] = [];
	let action: "pane" | "newTab" | null = "pane";
	const handlers = terminalUrlLinks({
		isCurrent: () => true,
		isReviewing: () => false,
		getAction: () => action,
		onOpenUrl: (url, action) => opened.push({ url, action }),
	});
	const click = () =>
		new MouseEvent("click", { button: 0, ctrlKey: true, cancelable: true });
	const first = click();
	handlers.onUrlClick?.(first, "http://localhost:3000/a");
	expect(first.defaultPrevented).toBe(true);
	action = "newTab";
	handlers.onUrlClick?.(click(), "http://localhost:3000/b");
	action = null;
	handlers.onUrlClick?.(click(), "http://localhost:3000/ignored");
	expect(opened).toEqual([
		{ url: "http://localhost:3000/a", action: "pane" },
		{ url: "http://localhost:3000/b", action: "newTab" },
	]);
});

test("review and stale owners never activate a URL even with an enabled mapping", () => {
	const opened: string[] = [];
	for (const options of [
		{ current: false, review: false },
		{ current: true, review: true },
	]) {
		const handler = terminalUrlLinks({
			isCurrent: () => options.current,
			isReviewing: () => options.review,
			getAction: () => "pane",
			onOpenUrl: (url) => opened.push(url),
		});
		handler.onUrlClick?.(
			new MouseEvent("click", { button: 0, ctrlKey: true }),
			"https://example.com/",
		);
	}
	expect(opened).toEqual([]);
});

test("a client without browser preferences keeps the existing external-only fallback", () => {
	const opened: unknown[] = [];
	const handler = terminalUrlLinks({
		isCurrent: () => true,
		isReviewing: () => false,
		onOpenUrl: (url, action) => opened.push({ url, action }),
	});
	handler.onUrlClick?.(
		new MouseEvent("click", { button: 0, ctrlKey: true }),
		"https://example.com/ignored",
	);
	handler.onUrlClick?.(
		new MouseEvent("click", { button: 0, ctrlKey: true, shiftKey: true }),
		"https://example.com/external",
	);
	expect(opened).toEqual([
		{ url: "https://example.com/external", action: "external" },
	]);
});
