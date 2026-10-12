import { expect, test } from "bun:test";
import type { DirectLocalNamespace } from "../../../shared/direct-workstation";
import { LocalDataController } from "./local-data-controller";

function fixture() {
	const rows: DirectLocalNamespace[] = ["a", "b"].map((id) => ({
		id,
		label: id,
		selected: id === "a",
		isDefault: id === "a",
		backendId: `backend-${id}`,
		namespaceId: id,
	}));
	let revision = 0;
	let pending = false;
	const events: string[] = [];
	const local = {
		listNamespaces: () => rows.map((row) => ({ ...row })),
		getSelectionRevision: () => revision,
		selectNamespace: (id: string) => {
			for (const row of rows) row.selected = row.id === id;
			revision++;
			events.push(`select:${id}`);
			const selected = rows.find((row) => row.id === id);
			if (!selected) throw new Error("Unknown namespace fixture");
			return { ...selected };
		},
	};
	const controller = new LocalDataController({
		local,
		hasPending: () => pending,
		disconnect: () => {
			events.push("close-A-and-invalidate-generation");
		},
		pin: (row) => {
			events.push(`pin:${row.backendId}:${row.namespaceId}`);
		},
	});
	return {
		controller,
		events,
		setPending: () => {
			pending = true;
		},
	};
}

test("namespace switch closes the A transport before replacing trusted pins", () => {
	const { controller, events } = fixture();
	expect(controller.selectNamespace("b").selected).toBe(true);
	expect(events).toEqual([
		"close-A-and-invalidate-generation",
		"select:b",
		"pin:backend-b:b",
	]);
});

test("pending operations prevent selection before any transport closes", () => {
	const { controller, events, setPending } = fixture();
	setPending();
	expect(() => controller.selectNamespace("b")).toThrow("pending");
	expect(events).toEqual([]);
});

test("an old Stop confirmation cannot act after selection changes A to B to A", async () => {
	const { controller, events } = fixture();
	let approve!: (value: boolean) => void;
	let called = false;
	const action = controller.runSelected(
		() =>
			new Promise<boolean>((resolve) => {
				approve = resolve;
			}),
		async () => {
			called = true;
		},
	);
	controller.selectNamespace("b");
	controller.selectNamespace("a");
	approve(true);
	await expect(action).rejects.toThrow("selection changed");
	expect(called).toBe(false);
	expect(events.filter((event) => event.startsWith("close"))).toHaveLength(2);
});

test("manual import captures its target and reserves selection during the operation", async () => {
	const { controller } = fixture();
	let finish!: () => void;
	let target: string | undefined;
	const importDone = controller.runSelected(
		async () => true,
		async (row) => {
			target = row.id;
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
	);
	await Promise.resolve();
	expect(target).toBe("a");
	expect(() => controller.selectNamespace("b")).toThrow("in progress");
	finish();
	await importDone;
	expect(controller.selectNamespace("b").id).toBe("b");
});

test("cancelled preparation has no disconnect or backend side effects", async () => {
	const { controller, events } = fixture();
	expect(
		await controller.runSelected(
			async () => false,
			async () => {
				throw new Error("unexpected");
			},
		),
	).toEqual({ status: "cancelled" });
	expect(events).toEqual([]);
});

test("pending intents created while a dialog waits also prevent its backend action", async () => {
	const { controller, events, setPending } = fixture();
	let approve!: (value: boolean) => void;
	const action = controller.runSelected(
		() =>
			new Promise<boolean>((resolve) => {
				approve = resolve;
			}),
		async () => {
			throw new Error("unexpected");
		},
	);
	setPending();
	approve(true);
	await expect(action).rejects.toThrow("pending");
	expect(events).toEqual([]);
});
