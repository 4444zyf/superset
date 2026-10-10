import { expect, test } from "bun:test";
import { closeWindowTransports } from "./window-transports";

test("closing and reopening a macOS window keeps the forwarding manager reusable", () => {
	let disposed = false;
	const listeners = new Set<string>();
	const closedOwners: number[] = [];
	const forwards = {
		open(id: string) {
			if (disposed) throw new Error("Port forwarding is disposed");
			listeners.add(id);
		},
		closeConnection(id: string) {
			listeners.delete(id);
		},
		dispose() {
			disposed = true;
			listeners.clear();
		},
	};
	forwards.open("mini");
	closeWindowTransports(10, ["mini"], {
		sockets: { closeOwner: (id) => closedOwners.push(id) },
		forwards,
	});
	expect(listeners.size).toBe(0);
	expect(closedOwners).toEqual([10]);
	forwards.open("mini");
	expect(listeners.has("mini")).toBe(true);
	forwards.dispose();
	expect(() => forwards.open("mini")).toThrow("disposed");
});
