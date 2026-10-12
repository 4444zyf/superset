import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type {
	DirectLocalDataApi,
	DirectLocalNamespace,
} from "../../../../../shared/direct-workstation";
import { LocalDataPanel } from "./LocalDataPanel";

afterEach(cleanup);
const first: DirectLocalNamespace = {
	id: "first",
	label: "Original",
	selected: true,
	isDefault: true,
	backendId: "backend-first",
	namespaceId: "first",
};
const second: DirectLocalNamespace = {
	id: "second",
	label: "Other work",
	selected: false,
	isDefault: false,
	backendId: "backend-second",
	namespaceId: "second",
};
function fixture() {
	let current = "first";
	let namespaces = [first, second];
	const selections: string[] = [];
	const removals: string[] = [];
	const api: DirectLocalDataApi = {
		listNamespaces: async () =>
			namespaces.map((row) => ({ ...row, selected: row.id === current })),
		selectNamespace: async (id) => {
			current = id;
			selections.push(id);
			return { ...(id === "first" ? first : second), selected: true };
		},
		createNamespace: async (label) => ({
			...second,
			id: "created",
			namespaceId: "created",
			label,
		}),
		removeNamespace: async (id) => {
			if (id === current || id === first.id)
				throw new Error("Selected or default namespace cannot be removed");
			removals.push(id);
			namespaces = namespaces.filter((row) => row.id !== id);
		},
		discoverLegacySources: async () => ({ sources: [], issues: [] }),
		previewLegacySources: async () => ({
			sources: [],
			conflicts: [],
			conflictCount: 0,
			conflictsTruncated: false,
			strategy: "separate-namespaces",
		}),
		importSource: async () => ({ status: "cancelled" }),
		listLegacyHistory: async () => ({ entries: [], total: 0 }),
		readLegacyHistory: async () => {
			throw new Error("No history selected");
		},
	};
	return { api, selections, removals };
}

test("selecting a namespace reports the accepted selection without connecting or starting it", async () => {
	const { api, selections } = fixture();
	const selected: DirectLocalNamespace[] = [];
	render(
		<LocalDataPanel
			api={api}
			onError={() => {}}
			onNamespaceSelected={(row) => selected.push(row)}
		/>,
	);
	const selector = await screen.findByLabelText("Local namespace");
	await waitFor(() => expect(selected).toHaveLength(1));
	await act(async () =>
		fireEvent.change(selector, { target: { value: "second" } }),
	);
	expect(selections).toEqual(["second"]);
	expect(selected.at(-1)?.id).toBe("second");
	expect((selector as HTMLSelectElement).value).toBe("second");
});

test("cancelling native namespace removal keeps its row and selection", async () => {
	const { api } = fixture();
	api.removeNamespace = async () => ({ status: "cancelled" });
	render(
		<LocalDataPanel
			api={api}
			onError={() => {}}
			onNamespaceSelected={() => {}}
		/>,
	);
	const selector = await screen.findByLabelText("Local namespace");
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Remove namespace" })),
	);
	expect((selector as HTMLSelectElement).value).toBe("first");
	expect(Boolean(screen.queryByRole("option", { name: "Other work" }))).toBe(
		true,
	);
	await screen.findByText("Cancelled");
});

test("namespace removal targets only an unselected additional row", async () => {
	const { api, removals } = fixture();
	render(
		<LocalDataPanel
			api={api}
			onError={() => {}}
			onNamespaceSelected={() => {}}
		/>,
	);
	const selector = await screen.findByLabelText("Local namespace");
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Remove namespace" })),
	);
	expect(removals).toEqual(["second"]);
	expect((selector as HTMLSelectElement).value).toBe("first");
	expect(Boolean(screen.queryByRole("option", { name: "Other work" }))).toBe(
		false,
	);
});
