import { afterEach, expect, test } from "bun:test";
import type {
	LegacyImportPreview,
	LegacySource,
} from "@superset/shared/direct-legacy-data";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { DirectLocalImportResult } from "../../../../../../../shared/direct-workstation";
import { LegacySourcesPanel } from "./LegacySourcesPanel";

afterEach(cleanup);
const sources: LegacySource[] = [
	{
		id: "first",
		format: "v2",
		sourceDirectory: "/home/.superset/host/old-one",
		sourceNamespace: "old-one",
	},
	{
		id: "second",
		format: "v1",
		sourceDirectory: "/home/.superset",
		sourceNamespace: "old-two",
	},
];
const preview: LegacyImportPreview = {
	sources: sources.map((source) => ({
		source,
		status: "ready",
		counts: { projects: 1, workspaces: 2, terminals: 1, chats: 0 },
	})),
	conflicts: [
		{
			kind: "repository-path",
			value: "/repo/shared",
			sourceIds: ["first", "second"],
			entityIds: ["project"],
		},
	],
	conflictCount: 1,
	conflictsTruncated: false,
	strategy: "separate-namespaces",
};
const imported: DirectLocalImportResult = {
	destinationNamespaceId: "new",
	sourceNamespace: "old-one",
	targetNamespace: "new",
	projects: 1,
	workspaces: 2,
	terminals: 1,
	chats: 0,
	warnings: [],
};

function fixture() {
	const inspections: string[][] = [],
		imports: unknown[] = [];
	const api = {
		discoverLegacySources: async () => ({ sources, issues: [] }),
		previewLegacySources: async (ids: string[]) => {
			inspections.push(ids);
			return preview;
		},
		importSource: async (input: { sourceId: string; label?: string }) => {
			imports.push(input);
			return imported;
		},
	};
	return { api, inspections, imports };
}

test("discovery and conflict preview are read-only until a source is explicitly imported", async () => {
	const f = fixture();
	const results: unknown[] = [];
	render(
		<LegacySourcesPanel
			api={f.api}
			namespaceId="selected"
			onError={() => {}}
			onImported={(result) => results.push(result)}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Discover local data" }));
	fireEvent.click(await screen.findByRole("checkbox", { name: /old-one/ }));
	fireEvent.click(screen.getByRole("checkbox", { name: /old-two/ }));
	fireEvent.click(
		screen.getByRole("button", { name: "Preview selected sources" }),
	);
	await screen.findByText("/repo/shared");
	expect(f.inspections).toEqual([["first", "second"]]);
	expect(f.imports).toEqual([]);
	const source = within(screen.getByRole("group", { name: "old-one" }));
	fireEvent.change(source.getByLabelText("Namespace name"), {
		target: { value: "Personal work" },
	});
	await act(async () =>
		fireEvent.click(source.getByRole("button", { name: "Import source" })),
	);
	expect(f.imports).toEqual([{ sourceId: "first", label: "Personal work" }]);
	expect(results).toEqual([imported]);
});

test("changing the source selection invalidates a pending preview", async () => {
	const f = fixture();
	let finish!: (result: LegacyImportPreview) => void;
	f.api.previewLegacySources = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	render(
		<LegacySourcesPanel
			api={f.api}
			namespaceId="selected"
			onError={() => {}}
			onImported={() => {}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Discover local data" }));
	const select = await screen.findByRole("checkbox", { name: /old-one/ });
	fireEvent.click(select);
	fireEvent.click(
		screen.getByRole("button", { name: "Preview selected sources" }),
	);
	fireEvent.click(select);
	await act(async () => finish(preview));
	expect(Boolean(screen.queryByText("/repo/shared"))).toBe(false);
	for (const button of screen.getAllByRole("button", { name: "Import source" }))
		expect((button as HTMLButtonElement).disabled).toBe(true);
	expect(f.imports).toEqual([]);
});

test("cancelled native import confirmation never reports an imported namespace", async () => {
	const f = fixture();
	const results: unknown[] = [];
	const api = {
		...f.api,
		importSource: async () => ({ status: "cancelled" as const }),
	};
	render(
		<LegacySourcesPanel
			api={api}
			namespaceId="selected"
			onError={() => {}}
			onImported={(result) => results.push(result)}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Discover local data" }));
	fireEvent.click(await screen.findByRole("checkbox", { name: /old-one/ }));
	await act(async () =>
		fireEvent.click(
			screen.getByRole("button", { name: "Preview selected sources" }),
		),
	);
	await act(async () =>
		fireEvent.click(
			within(screen.getByRole("group", { name: "old-one" })).getByRole(
				"button",
				{ name: "Import source" },
			),
		),
	);
	expect(results).toEqual([]);
	await screen.findByText("Cancelled");
});
