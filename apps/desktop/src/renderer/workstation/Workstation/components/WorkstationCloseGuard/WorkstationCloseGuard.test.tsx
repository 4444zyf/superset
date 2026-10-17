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

test("chat draft storage failure blocks a clean-file window close until an explicit successful Save All retry", async () => {
	const { WorkstationChatDraftStore } = await import(
		"../../providers/WorkstationChatDrafts/workstation-chat-drafts"
	);
	const f = fixture();
	await settle();
	let fail = true;
	const drafts = new WorkstationChatDraftStore(
		{
			getChatDrafts: async () => ({ revision: 0, invalid: false, entries: [] }),
			saveChatDrafts: async (input) => {
				if (fail) throw new Error("Disk full");
				return { revision: 1, invalid: false, entries: input.entries };
			},
		},
		() => () => {},
	);
	await drafts.start();
	drafts.change(
		{
			connectionId: connection.connectionId,
			backendId: connection.backendId,
			namespaceId: connection.namespaceId,
			workspaceId: "workspace",
			sessionId: "chat",
		},
		{ text: "unsent", attachments: [] },
	);
	render(
		<WorkstationCloseGuard
			api={f.api}
			documents={f.manager}
			chatDrafts={drafts}
		/>,
	);
	let pending!: Promise<boolean>;
	let approved = false;
	await act(async () => {
		pending = f.request();
		void pending.then((allow) => {
			approved = allow;
		});
		await settle();
	});
	expect(approved).toBe(false);
	expect(screen.getByRole("alertdialog").textContent).toContain("Disk full");
	expect(
		drafts.get({
			connectionId: connection.connectionId,
			backendId: connection.backendId,
			namespaceId: connection.namespaceId,
			workspaceId: "workspace",
			sessionId: "chat",
		}).text,
	).toBe("unsent");
	fail = false;
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save All" }));
		await settle();
	});
	expect(await pending).toBe(true);
	expect(f.writes).toEqual([]);
	drafts.stop();
});

test("unmounting while chat draft storage is loading cannot approve the departed renderer's close request", async () => {
	const { WorkstationChatDraftStore } = await import(
		"../../providers/WorkstationChatDrafts/workstation-chat-drafts"
	);
	const f = fixture();
	await settle();
	let loaded!: (value: {
		revision: number;
		invalid: boolean;
		entries: [];
	}) => void;
	const drafts = new WorkstationChatDraftStore(
		{
			getChatDrafts: () =>
				new Promise((resolve) => {
					loaded = resolve;
				}),
		},
		() => () => {},
	);
	const view = render(
		<WorkstationCloseGuard
			api={f.api}
			documents={f.manager}
			chatDrafts={drafts}
		/>,
	);
	const pending = f.request();
	view.unmount();
	loaded({ revision: 0, invalid: false, entries: [] });
	expect(await pending).toBe(false);
	drafts.stop();
});

test("a late chat-draft flush after the close dialog unmounts cannot start a file save", async () => {
	const f = fixture();
	await settle();
	f.doc.setContent("must remain a draft");
	let calls = 0;
	let flushed!: () => void;
	const drafts = {
		flush: async () => {
			if (++calls === 2)
				await new Promise<void>((resolve) => {
					flushed = resolve;
				});
		},
	};
	const view = render(
		<WorkstationCloseGuard
			api={f.api}
			documents={f.manager}
			chatDrafts={drafts}
		/>,
	);
	let pending!: Promise<boolean>;
	await act(async () => {
		pending = f.request();
		await settle();
	});
	fireEvent.click(screen.getByRole("button", { name: "Save All" }));
	view.unmount();
	flushed();
	await act(settle);
	expect(await pending).toBe(false);
	expect(f.writes).toEqual([]);
	expect(f.doc.dirty).toBe(true);
});

test("a transient settings draft shares the original window guard and failed Save All cannot approve close", async () => {
	const f = fixture();
	await settle();
	let dirty = true,
		fail = true,
		saves = 0;
	const listeners = new Set<() => void>();
	let version = 0;
	const guard = {
		id: "settings",
		label: () => "Remote Codex",
		isDirty: () => dirty,
		isPending: () => false,
		getError: () => "Agent configuration changed",
		save: async () => {
			saves++;
			if (fail) return false;
			dirty = false;
			version++;
			for (const listener of listeners) listener();
			return true;
		},
	};
	const editors = {
		getVersion: () => version,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getUnsaved: () => (dirty ? [guard] : []),
	};
	render(
		<WorkstationCloseGuard
			api={f.api}
			documents={f.manager}
			editors={editors}
		/>,
	);
	let request!: Promise<boolean>;
	let approved = false;
	await act(async () => {
		request = f.request();
		void request.then((value) => {
			approved = value;
		});
		await settle();
	});
	expect(approved).toBe(false);
	await screen.findByText("Remote Codex");
	fireEvent.click(screen.getByRole("button", { name: "Save All" }));
	await screen.findByText("Agent configuration changed");
	expect(approved).toBe(false);
	expect(dirty).toBe(true);
	expect(saves).toBe(1);
	fail = false;
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save All" }));
		await settle();
	});
	expect(await request).toBe(true);
	expect(saves).toBe(2);
	expect(f.writes).toEqual([]);
});
