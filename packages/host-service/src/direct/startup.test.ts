import { expect, test } from "bun:test";
import { prepareDirectRuntime } from "./startup";

test("a frozen candidate does not initialize or repair the live terminal daemon", async () => {
	let initializes = 0;
	await prepareDirectRuntime({ frozen: true }, async () => {
		initializes++;
	});
	expect(initializes).toBe(0);
	await prepareDirectRuntime({ frozen: false }, async () => {
		initializes++;
	});
	expect(initializes).toBe(1);
});
