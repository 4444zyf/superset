import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { OwnedSshProcesses } from "./owned-processes";

class Child extends EventEmitter {
	kills = 0;
	kill(): boolean {
		this.kills++;
		this.emit("close");
		return true;
	}
}

test("cancel closes pending local SSH children only for its connection", () => {
	const owned = new OwnedSshProcesses();
	const first = new Child();
	const second = new Child();
	const other = new Child();
	owned.track("a", first);
	owned.track("a", second);
	owned.track("b", other);
	owned.cancel("a");
	expect([first.kills, second.kills, other.kills]).toEqual([1, 1, 0]);
	owned.dispose();
	expect([first.kills, second.kills, other.kills]).toEqual([1, 1, 1]);
});

test("a completed SSH child is no longer owned or killed during shutdown", () => {
	const owned = new OwnedSshProcesses();
	const child = new Child();
	owned.track("a", child);
	child.emit("close");
	owned.dispose();
	expect(child.kills).toBe(0);
});

test("a child spawned after shutdown cannot outlive its closed owner", () => {
	const owned = new OwnedSshProcesses();
	owned.dispose();
	const child = new Child();
	owned.track("a", child);
	expect(child.kills).toBe(1);
});

test("cancellation during async preparation also cancels its eventual child", () => {
	const owned = new OwnedSshProcesses();
	const version = owned.version("a");
	owned.cancel("a");
	const stale = new Child();
	owned.track("a", stale, version);
	const replacement = new Child();
	owned.track("a", replacement, owned.version("a"));
	expect([stale.kills, replacement.kills]).toEqual([1, 0]);
	owned.dispose();
});
