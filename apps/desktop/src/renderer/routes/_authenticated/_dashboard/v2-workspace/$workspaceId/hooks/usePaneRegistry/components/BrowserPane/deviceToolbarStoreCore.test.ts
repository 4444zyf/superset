import { expect, test } from "bun:test";
import { DeviceToolbarStoreCore } from "./deviceToolbarStoreCore";

test("the original device presets, rotation and close send the corresponding emulation dimensions", async () => {
	const writes: unknown[] = [];
	const store = new DeviceToolbarStoreCore(async (input) => {
		writes.push(input);
	});
	store.toggle("pane");
	store.setDevice("pane", "iphone-14-pro");
	store.toggleRotate("pane");
	store.close("pane");
	expect(writes).toEqual([
		{ paneId: "pane", params: { width: 375, height: 667 } },
		{ paneId: "pane", params: { width: 393, height: 852 } },
		{ paneId: "pane", params: { width: 852, height: 393 } },
		{ paneId: "pane", params: null },
	]);
	expect(store.getState("pane")).toEqual({
		isOpen: false,
		deviceId: "iphone-se",
		isRotated: false,
	});
});

test("reset clears only the owning pane and a later reopen uses the default device", () => {
	const writes: unknown[] = [];
	const store = new DeviceToolbarStoreCore(async (input) => {
		writes.push(input);
	});
	let notified = 0;
	store.subscribe("first", () => notified++);
	store.toggle("first");
	store.toggle("second");
	store.setDevice("first", "pixel-7");
	store.reset("first");
	expect(store.getState("second").isOpen).toBe(true);
	expect(writes.at(-1)).toEqual({ paneId: "first", params: null });
	const previous = notified;
	store.toggle("first");
	expect(notified).toBe(previous);
	expect(writes.at(-1)).toEqual({
		paneId: "first",
		params: { width: 375, height: 667 },
	});
	store.reset("first");
	store.reset("second");
});
