import { expect, test } from "bun:test";
import { runConfirmedRemoteControl } from "./confirmed-remote-control";

test("a confirmation cannot stop the new destination after its profile is edited", async () => {
	let profile: { id: string; host: string; name: string } | null = {
		id: "remote",
		host: "old.example",
		name: "Old",
	};
	let approve!: (value: boolean) => void;
	let controlled = false;
	const action = runConfirmedRemoteControl({
		getProfile: () => profile,
		confirm: () =>
			new Promise<boolean>((resolve) => {
				approve = resolve;
			}),
		control: async () => {
			controlled = true;
		},
	});
	profile = { id: "remote", host: "new.example", name: "New" };
	approve(true);
	await expect(action).rejects.toThrow("destination changed");
	expect(controlled).toBe(false);
});

test("removing a profile while confirmation waits performs no backend action", async () => {
	let profile: { id: string; host: string; name: string } | null = {
		id: "remote",
		host: "old.example",
		name: "Old",
	};
	let approve!: (value: boolean) => void;
	const action = runConfirmedRemoteControl({
		getProfile: () => profile,
		confirm: () =>
			new Promise<boolean>((resolve) => {
				approve = resolve;
			}),
		control: async () => {
			throw new Error("unexpected");
		},
	});
	profile = null;
	approve(true);
	await expect(action).rejects.toThrow("destination changed");
});

test("renaming the same verified destination preserves the explicit control", async () => {
	const profile = { id: "remote", host: "old.example", name: "Old" };
	const result = await runConfirmedRemoteControl({
		getProfile: () => profile,
		confirm: async () => {
			profile.name = "Renamed";
			return true;
		},
		control: async () => "completed",
	});
	expect(result).toBe("completed");
});
