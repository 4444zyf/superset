import { expect, test } from "bun:test";
import { planGarbageCollection } from "./runtime-retention";

test("cache reclamation never selects a referenced launcher, current candidate or rollback release", () => {
	const releases = [
		{ id: "old", bytes: 80, modified: 1 },
		{ id: "current", bytes: 100, modified: 2 },
		{ id: "candidate", bytes: 110, modified: 3 },
		{ id: "launcher", bytes: 20, modified: 0 },
		{ id: "cache", bytes: 60, modified: 4 },
	];
	expect(
		planGarbageCollection(
			releases,
			new Set(["current", "candidate", "launcher"]),
			60,
		),
	).toEqual(["old"]);
});
test("cache reclamation keeps newer unused packages within its capacity budget", () => {
	expect(
		planGarbageCollection(
			[
				{ id: "a", bytes: 10, modified: 1 },
				{ id: "b", bytes: 10, modified: 2 },
				{ id: "c", bytes: 10, modified: 3 },
			],
			new Set(),
			10,
		),
	).toEqual(["a", "b"]);
});
