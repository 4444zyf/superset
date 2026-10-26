import { afterEach, expect, test } from "bun:test";
import {
	currentDirectAgentHookUrl,
	registerDirectAgentHookPort,
} from "./agent-hook-url";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

test("a direct terminal uses the actual listening hook port instead of an inherited service port", () => {
	cleanups.push(registerDirectAgentHookPort(43123));
	expect(currentDirectAgentHookUrl()).toBe(
		"http://127.0.0.1:43123/trpc/notifications.hook",
	);
});

test("old listener cleanup cannot erase a newer listener's hook address", () => {
	const first = registerDirectAgentHookPort(43123),
		second = registerDirectAgentHookPort(43124);
	cleanups.push(first, second);
	first();
	expect(currentDirectAgentHookUrl()).toBe(
		"http://127.0.0.1:43124/trpc/notifications.hook",
	);
	second();
	expect(currentDirectAgentHookUrl()).toBeNull();
});

test("the new direct hook registration accepts only a real TCP port", () => {
	for (const port of [0, -1, 65536, 1.5, Number.NaN])
		expect(() => registerDirectAgentHookPort(port)).toThrow(
			"Invalid direct agent hook port",
		);
	expect(currentDirectAgentHookUrl()).toBeNull();
});
