import { expect, test } from "bun:test";
import { TerminalModes } from "@superset/pty-daemon/terminal-modes";
import {
	TerminalVersionQueries,
	TerminalVersionReplies,
} from "./terminal-version-replies";

test("version queries retain parser state across bytes and ignore cancelled or unsupported sequences", () => {
	const queries = new TerminalVersionQueries();
	const feed = (text: string) => queries.feed(Buffer.from(text));
	expect(feed("中文\x1b[>")).toBe(0);
	expect(feed("0q")).toBe(1);
	expect(feed("\x1b[>1q\x1b[>\x18q\x1b]0;>q\x07")).toBe(0);
	expect(feed("\x1b[>q\x1b[>0;1q")).toBe(2);
	const modes = new TerminalModes();
	modes.feed(Buffer.from("\x1b[>"));
	queries.restoreParser(modes.snapshot().parser);
	expect(feed("q")).toBe(1);
});

test("only complete version response events consume the bounded allowance of their own socket", () => {
	const a = new TerminalVersionReplies();
	const b = new TerminalVersionReplies();
	const reply = "\x1bP>|Superset Remix (xterm.js)\x1b\\";
	expect(a.allowsInput(reply)).toBe(false);
	a.expect(1);
	for (const ordinary of [
		"echo 中文\r",
		"\x1b[1;2A",
		"\x1b[1;1R",
		`paste ${reply}\r`,
	])
		expect(a.allowsInput(ordinary)).toBe(true);
	expect(b.allowsInput(reply)).toBe(false);
	expect(a.allowsInput(reply)).toBe(true);
	expect(a.allowsInput(reply)).toBe(false);
	a.expect(2);
	expect(a.allowsInput(reply)).toBe(true);
	expect(a.allowsInput(reply)).toBe(true);
	expect(a.allowsInput(reply)).toBe(false);
});
