import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { WorkstationFileDocuments } from "../../providers/WorkstationFileDocuments";
import { WorkstationCloseGuard } from "./WorkstationCloseGuard";

afterEach(cleanup);
const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};
const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
	generation: 1,
	capabilities: { files: true },
};
function fixture() {
	let ask: ((kind: "window" | "quit") => Promise<boolean>) | undefined;
	let conflict = false;
	const writes: unknown[] = [];
	const api = {
		onWindowCloseRequest: (listener: typeof ask) => {
			ask = listener;
			return () => {
				ask = undefined;
			};
		},
		rpc: async (request: { path: string; input: unknown }) => {
			if (request.path === "filesystem.writeFile") {
				writes.push(request.input);
				return conflict
					? { ok: false, reason: "conflict" }
					: { ok: true, revision: "saved" };
			}
			return {
				kind: "text",
				content: "original",
				revision: "r1",
				exceededLimit: false,
			};
		},
	} as unknown as DirectWorkstationApi;
	const manager = new WorkstationFileDocuments(api);
	const doc = manager.acquire(connection, "hidden-workspace", "/repo/note.txt");
	const request = () => {
		if (!ask) throw new Error("Close listener missing");
		return ask("window");
	};
	return {
		api,
		manager,
		doc,
		request,
		writes,
		setConflict: (value: boolean) => {
			conflict = value;
		},
	};
}
test("a background file draft blocks close until cancel or an explicit Don't Save action without writing the disk", async () => {
	const f = fixture();
	await settle();
	f.doc.setContent("private background draft");
	render(<WorkstationCloseGuard api={f.api} documents={f.manager} />);
	let pending!: Promise<boolean>;
	let resolved = false;
	await act(async () => {
		pending = f.request();
		void pending.then(() => {
			resolved = true;
		});
		await settle();
	});
	expect(screen.queryByRole("alertdialog")).not.toBeNull();
	expect(resolved).toBe(false);
	expect(f.writes).toEqual([]);
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(await pending).toBe(false);
	expect(f.doc.content).toMatchObject({ value: "private background draft" });
	await act(async () => {
		pending = f.request();
		await settle();
	});
	fireEvent.click(screen.getByRole("button", { name: "Don't Save" }));
	expect(await pending).toBe(true);
	expect(f.writes).toEqual([]);
	expect(f.doc.content).toMatchObject({ value: "private background draft" });
});
test("Save All keeps the original dialog and window after a conflict and permits close only after an explicit successful retry", async () => {
	const f = fixture();
	await settle();
	f.doc.setContent("only save explicitly");
	f.setConflict(true);
	render(<WorkstationCloseGuard api={f.api} documents={f.manager} />);
	let pending!: Promise<boolean>;
	let resolved = false;
	await act(async () => {
		pending = f.request();
		void pending.then(() => {
			resolved = true;
		});
		await settle();
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save All" }));
		await settle();
	});
	expect(resolved).toBe(false);
	expect(screen.getByRole("alertdialog").textContent).toContain(
		"File changed on disk",
	);
	expect(f.doc.dirty).toBe(true);
	expect(f.writes).toHaveLength(1);
	f.setConflict(false);
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save All" }));
		await settle();
	});
	expect(await pending).toBe(true);
	expect(f.writes).toHaveLength(2);
	expect(f.writes[1]).toMatchObject({
		precondition: { ifMatch: "r1" },
		options: { create: false, overwrite: true },
	});
	expect(f.doc.dirty).toBe(false);
});

test("a clean document permits close immediately and unmounting with a dirty prompt cancels the old request", async () => {
	const f = fixture();
	await settle();
	const view = render(
		<WorkstationCloseGuard api={f.api} documents={f.manager} />,
	);
	expect(await f.request()).toBe(true);
	expect(screen.queryByRole("alertdialog")).toBeNull();
	act(() => f.doc.setContent("keep on cancelled owner"));
	let pending!: Promise<boolean>;
	await act(async () => {
		pending = f.request();
		await settle();
	});
	view.unmount();
	expect(await pending).toBe(false);
	expect(f.doc.dirty).toBe(true);
	expect(f.writes).toEqual([]);
});
