import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectSocketEvent,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteTerminal, type TerminalEmulator } from "./RemoteTerminal";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};

test("a mismatched attached identity permanently disables input on that transport", async () => {
	let listener!: (event: DirectSocketEvent) => void;
	let socketId = "";
	let input!: (data: string) => void;
	const sent: unknown[] = [];
	const api = {
		onSocket: (callback: typeof listener) => {
			listener = callback;
			return () => {};
		},
		openSocket: async () => {
			throw new Error("Ordinary attach must not be used");
		},
		openRestoredTerminal: async (
			_connection: unknown,
			_ref: unknown,
			id: string,
		) => {
			socketId = id;
		},
		sendSocket: async (_id: string, value: string) => {
			sent.push(JSON.parse(value));
		},
		closeSocket: async () => {},
	} as unknown as DirectWorkstationApi;
	const emulator: TerminalEmulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write() {},
			writeln() {},
			onData(callback) {
				input = callback;
				return { dispose() {} };
			},
			onResize() {
				return { dispose() {} };
			},
			dispose() {},
		},
		fit() {},
	};
	render(
		<RemoteTerminal
			api={api}
			connection={connection}
			terminalId="terminal"
			restoreRef={{
				workspaceId: "workspace",
				kind: "terminal",
				resourceId: "terminal",
				executionId: "original",
			}}
			onError={() => {}}
			createEmulator={() => emulator}
		/>,
	);
	await waitFor(() => expect(socketId).not.toBe(""));
	listener({ socketId, kind: "open" });
	input("before attached");
	expect(sent).toEqual([]);
	listener({
		socketId,
		kind: "message",
		data: JSON.stringify({
			type: "attached",
			terminalId: "terminal",
			workspaceId: "workspace",
			executionId: "replacement",
		}),
	});
	input("wrong identity");
	expect(sent).toEqual([]);
	listener({
		socketId,
		kind: "message",
		data: JSON.stringify({
			type: "attached",
			terminalId: "terminal",
			workspaceId: "workspace",
			executionId: "original",
		}),
	});
	input("user input");
	expect(sent).not.toContainEqual({ type: "input", data: "user input" });
	listener({
		socketId,
		kind: "message",
		data: JSON.stringify({ type: "exit", exitCode: 0 }),
	});
	const count = sent.length;
	input("after exit");
	expect(sent).toHaveLength(count);
});

test("matching restored execution enables input only after attached and revokes it on exit", async () => {
	let listener!: (event: DirectSocketEvent) => void;
	let socketId = "";
	let input!: (data: string) => void;
	const sent: unknown[] = [];
	const api = {
		onSocket: (cb: typeof listener) => {
			listener = cb;
			return () => {};
		},
		openRestoredTerminal: async (_c: unknown, _r: unknown, id: string) => {
			socketId = id;
		},
		sendSocket: async (_id: string, value: string) => {
			sent.push(JSON.parse(value));
		},
		closeSocket: async () => {},
	} as unknown as DirectWorkstationApi;
	const emulator: TerminalEmulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write() {},
			writeln() {},
			onData(callback) {
				input = callback;
				return { dispose() {} };
			},
			onResize() {
				return { dispose() {} };
			},
			dispose() {},
		},
		fit() {},
	};
	render(
		<RemoteTerminal
			api={api}
			connection={connection}
			terminalId="terminal"
			restoreRef={{
				workspaceId: "workspace",
				kind: "terminal",
				resourceId: "terminal",
				executionId: "original",
			}}
			onError={() => {}}
			createEmulator={() => emulator}
		/>,
	);
	await waitFor(() => expect(socketId).not.toBe(""));
	listener({ socketId, kind: "open" });
	input("before attached");
	expect(sent).toEqual([]);
	listener({
		socketId,
		kind: "message",
		data: JSON.stringify({
			type: "attached",
			terminalId: "terminal",
			workspaceId: "workspace",
			executionId: "original",
		}),
	});
	input("user input");
	expect(sent).toContainEqual({ type: "input", data: "user input" });
	listener({
		socketId,
		kind: "message",
		data: JSON.stringify({ type: "exit", exitCode: 0 }),
	});
	const count = sent.length;
	input("after exit");
	expect(sent).toHaveLength(count);
});

test("unmount closes terminal subscriptions and transports without disposing the remote process", async () => {
	let listener!: (event: DirectSocketEvent) => void;
	let socketId = "";
	let unsubscribed = false;
	let emulatorDisposed = false;
	const closed: string[] = [];
	const sent: unknown[] = [];
	const writes: unknown[] = [];
	const api = {
		onSocket: (callback: (event: DirectSocketEvent) => void) => {
			listener = callback;
			return () => {
				unsubscribed = true;
			};
		},
		openSocket: async (_connection: unknown, _path: string, id: string) => {
			socketId = id;
		},
		closeSocket: async (id: string) => {
			closed.push(id);
		},
		sendSocket: async (_id: string, value: string) => {
			sent.push(JSON.parse(value));
		},
	} as unknown as DirectWorkstationApi;
	const emulator: TerminalEmulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write: (bytes) => {
				writes.push(bytes);
			},
			writeln: () => {},
			onData: () => ({ dispose() {} }),
			onResize: () => ({ dispose() {} }),
			dispose: () => {
				emulatorDisposed = true;
			},
		},
		fit() {},
	};
	const rendered = render(
		<RemoteTerminal
			api={api}
			connection={connection}
			terminalId="terminal"
			onError={() => {}}
			createEmulator={() => emulator}
		/>,
	);
	await waitFor(() => expect(socketId).not.toBe(""));
	listener({ socketId, kind: "open" });
	listener({ socketId, kind: "message", data: new Uint8Array([0xe4, 0xb8]) });
	expect(writes).toEqual([new Uint8Array([0xe4, 0xb8])]);
	rendered.unmount();
	listener({ socketId, kind: "message", data: new Uint8Array([0xad]) });
	expect(writes).toHaveLength(1);
	expect(closed).toContain(socketId);
	expect(unsubscribed).toBe(true);
	expect(emulatorDisposed).toBe(true);
	expect(sent).not.toContainEqual({ type: "dispose" });
});

test("live typography changes reconfigure the same emulator and keep its attached socket", async () => {
	const { WorkstationPreferencesContext } = await import(
		"../../providers/WorkstationPreferencesContext"
	);
	const calls: string[] = [];
	const appearances: unknown[] = [];
	let created = 0;
	let listener!: (event: DirectSocketEvent) => void;
	const api = {
		onSocket: (cb: typeof listener) => {
			listener = cb;
			return () => {};
		},
		openSocket: async (_c: unknown, _p: unknown, id: string) => {
			calls.push(id);
		},
		sendSocket: async () => {},
		closeSocket: async () => {
			calls.push("closed");
		},
	} as unknown as DirectWorkstationApi;
	const emulator: TerminalEmulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write() {},
			writeln() {},
			onData() {
				return { dispose() {} };
			},
			onResize() {
				return { dispose() {} };
			},
			dispose() {},
		},
		fit() {},
		applyAppearance: (appearance) => appearances.push(appearance),
	};
	const createEmulator = () => {
		created++;
		return emulator;
	};
	const values = {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "dark",
		fontSettings: {},
		fileOpenMode: "split-pane" as const,
		fileAutoSave: "off" as const,
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	};
	const props = {
		api,
		connection,
		terminalId: "terminal",
		onError: () => {},
		createEmulator,
	};
	const view = render(
		<WorkstationPreferencesContext
			value={{ revision: 0, invalid: false, values }}
		>
			<RemoteTerminal {...props} />
		</WorkstationPreferencesContext>,
	);
	await waitFor(() => expect(calls).toHaveLength(1));
	act(() => listener({ socketId: calls[0], kind: "open" }));
	view.rerender(
		<WorkstationPreferencesContext
			value={{
				revision: 1,
				invalid: false,
				values: {
					...values,
					themeId: "light",
					fontSettings: { terminalFontSize: 18 },
				},
			}}
		>
			<RemoteTerminal {...props} />
		</WorkstationPreferencesContext>,
	);
	await waitFor(() =>
		expect(appearances.at(-1)).toMatchObject({ fontSize: 18 }),
	);
	expect(created).toBe(1);
	expect(calls).toHaveLength(1);
	expect(
		view.container
			.querySelector("[data-restore-state]")
			?.getAttribute("data-restore-state"),
	).toBe("attached");
});

test.each([
	false,
	true,
])("a pasted image is bound to its original terminal execution (switch=%s)", async (switched) => {
	const requests: { path: string; input: Record<string, unknown> }[] = [];
	const pasted: string[] = [];
	let complete!: () => void;
	const written = new Promise<void>((resolve) => {
		complete = resolve;
	});
	let listener!: (e: DirectSocketEvent) => void;
	let sid = "";
	const api = {
		onSocket: (cb: typeof listener) => {
			listener = cb;
			return () => {};
		},
		openRestoredTerminal: async (_c: unknown, _r: unknown, id: string) => {
			sid = id;
		},
		sendSocket: async () => {},
		closeSocket: async () => {},
		rpc: async (r: { path: string; input: Record<string, unknown> }) => {
			requests.push(r);
			if (
				r.path === "filesystem.writeFile" &&
				typeof r.input.content === "object"
			)
				await written;
			return r.path === "workspace.get"
				? { worktreePath: "/remote/Superset Remix/worktrees/project/branch" }
				: { ok: true };
		},
	} as unknown as DirectWorkstationApi;
	const emulator: TerminalEmulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write() {},
			writeln() {},
			onData() {
				return { dispose() {} };
			},
			onResize() {
				return { dispose() {} };
			},
			dispose() {},
			input() {},
			paste(text: string) {
				pasted.push(text);
			},
		},
		fit() {},
	};
	const view = render(
		<RemoteTerminal
			api={api}
			connection={{ ...connection, capabilities: { workstationFilesV1: true } }}
			terminalId="terminal"
			restoreRef={{
				workspaceId: "workspace",
				resourceId: "terminal",
				kind: "terminal",
				executionId: "exec",
			}}
			onError={(error) => {
				throw new Error(error);
			}}
			createEmulator={() => emulator}
		/>,
	);
	await waitFor(() => expect(sid).not.toBe(""));
	act(() =>
		listener({
			socketId: sid,
			kind: "message",
			data: JSON.stringify({
				type: "attached",
				terminalId: "terminal",
				workspaceId: "workspace",
				executionId: "exec",
			}),
		}),
	);
	const event = new Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: {
			files: [
				new File([new Uint8Array([1, 2, 3])], "image.png", {
					type: "image/png",
				}),
			],
			getData: () => "",
		},
	});
	act(() =>
		view.container.querySelector("[data-terminal-id]")!.dispatchEvent(event),
	);
	await waitFor(() =>
		expect(
			requests.some(
				(r) =>
					r.path === "filesystem.writeFile" &&
					typeof r.input.content === "object",
			),
		).toBe(true),
	);
	if (switched) {
		view.unmount();
		await act(async () => complete());
		expect(pasted).toEqual([]);
		return;
	}
	await act(async () => complete());
	await waitFor(() => expect(pasted).toHaveLength(1));
	await waitFor(() => expect(view.queryByText("Sending…") === null).toBe(true));
	expect(pasted[0]).toContain("image.png");
	expect(pasted[0]).toContain("/remote/");
	expect(event.defaultPrevented).toBe(true);
	expect(
		requests.filter((r) => r.path === "filesystem.writeFile").at(-1)?.input,
	).toMatchObject({
		workspaceId: "workspace",
		content: { kind: "base64", data: "AQID" },
		options: { create: true, overwrite: false },
	});
});

test("a rejected clipboard file reports an error without failing its attached terminal", async () => {
	let listener!: (e: DirectSocketEvent) => void;
	let sid = "";
	const failures: string[] = [];
	const api = {
		onSocket: (cb: typeof listener) => {
			listener = cb;
			return () => {};
		},
		openRestoredTerminal: async (_c: unknown, _r: unknown, id: string) => {
			sid = id;
		},
		sendSocket: async () => {},
		closeSocket: async () => {},
	} as unknown as DirectWorkstationApi;
	const emulator: TerminalEmulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write() {},
			writeln() {},
			onData() {
				return { dispose() {} };
			},
			onResize() {
				return { dispose() {} };
			},
			dispose() {},
			input() {},
			paste() {},
		},
		fit() {},
	};
	const view = render(
		<RemoteTerminal
			api={api}
			connection={connection}
			terminalId="terminal"
			restoreRef={{
				workspaceId: "workspace",
				resourceId: "terminal",
				kind: "terminal",
				executionId: "exec",
			}}
			onError={(e) => failures.push(e)}
			createEmulator={() => emulator}
		/>,
	);
	await waitFor(() => expect(sid !== "").toBe(true));
	act(() =>
		listener({
			socketId: sid,
			kind: "message",
			data: JSON.stringify({
				type: "attached",
				terminalId: "terminal",
				workspaceId: "workspace",
				executionId: "exec",
			}),
		}),
	);
	const event = new Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: {
			files: [new File([], "empty.png", { type: "image/png" })],
			getData: () => "",
		},
	});
	act(() =>
		view.container.querySelector("[data-terminal-id]")!.dispatchEvent(event),
	);
	await waitFor(() => expect(view.queryByRole("alert") !== null).toBe(true));
	expect(failures).toEqual([]);
	expect(
		view.container
			.querySelector("[data-terminal-id]")
			?.getAttribute("data-restore-state"),
	).toBe("attached");
});
