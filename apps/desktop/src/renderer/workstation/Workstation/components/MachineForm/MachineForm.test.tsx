import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { DirectWorkstationApi } from "../../types";
import { MachineForm } from "./MachineForm";

afterEach(cleanup);

test("testing an unsaved SSH profile probes the entered configuration without saving credentials or installing", async () => {
	const tested: unknown[] = [];
	const saved: unknown[] = [];
	const api = {
		platform: "linux",
		testProfile: async (profile: unknown) => {
			tested.push(profile);
			return { platform: "darwin", architecture: "arm64", installed: false };
		},
	} as unknown as DirectWorkstationApi;
	render(
		<MachineForm
			api={api}
			onSave={async (profile) => {
				saved.push(profile);
				return true;
			}}
			onClose={() => {}}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Mac mini" },
	});
	fireEvent.change(screen.getByLabelText("SSH host"), {
		target: { value: "mini.example" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
	await screen.findByText("SSH connection successful");
	expect(tested).toHaveLength(1);
	expect(tested[0]).toMatchObject({ name: "Mac mini", host: "mini.example" });
	expect(saved).toEqual([]);
	fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
	await waitFor(() => expect(saved).toHaveLength(1));
	expect(JSON.stringify(saved)).not.toMatch(/password|token/);
});

test("editing a connection while its probe is pending discards the old success", async () => {
	let finish!: (value: {
		platform: string;
		architecture: string;
		installed: boolean;
	}) => void;
	const api = {
		platform: "linux",
		testProfile: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	} as unknown as DirectWorkstationApi;
	render(
		<MachineForm
			api={api}
			profile={{ id: "draft", name: "Mini", host: "old.example" }}
			onSave={async () => true}
			onClose={() => {}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
	fireEvent.input(screen.getByLabelText("SSH host"), {
		target: { value: "new.example" },
	});
	await act(async () =>
		finish({ platform: "darwin", architecture: "arm64", installed: true }),
	);
	expect(screen.queryByText("SSH connection successful")).toBeNull();
});
