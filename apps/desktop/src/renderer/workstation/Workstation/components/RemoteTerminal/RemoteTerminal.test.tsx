import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import type {
	DirectDescriptor,
	DirectSocketEvent,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteTerminal, type TerminalEmulator } from "./RemoteTerminal";

afterEach(cleanup);

test.each([
	true,
	false,
])("history uses replay rendering only when the host marks a boundary (marked=%s)", async (marked) => {
	let listener: ((event: DirectSocketEvent) => void) | undefined;
	let socketId = "";
	const writes: string[] = [];
	const emulator = {
		terminal: {
			cols: 80,
			rows: 24,
			write(data: string | Uint8Array) {
				writes.push("live:" + new TextDecoder().decode(data as Uint8Array));
			},
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
		beginReplay() {
			writes.push("begin");
		},
		endReplay() {
			writes.push("end");
		},
		writeReplay(data: Uint8Array) {
			writes.push("history:" + new TextDecoder().decode(data));
		},
	};
	const api = {
		onSocket(callback: (event: DirectSocketEvent) => void) {
			listener = callback;
			return () => {};
		},
		async openRestoredTerminal(
			_connection: unknown,
			_ref: unknown,
			id: string,
		) {
			socketId = id;
		},
		async sendSocket() {},
		async closeSocket() {},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteTerminal
			api={api}
			connection={connection}
			terminalId="terminal"
			restoreRef={{
				kind: "terminal",
				workspaceId: "workspace",
				resourceId: "terminal",
				executionId: "execution",
			}}
			onError={() => {}}
			createEmulator={() => emulator}
		/>,
	);
	await waitFor(() => expect(socketId).not.toBe(""));
	const emit = (data: string | Uint8Array) => {
		if (!listener) throw new Error("Socket listener missing");
		act(() => listener?.({ socketId, kind: "message", data }));
	};
	emit(
		JSON.stringify({
			type: "attached",
			terminalId: "terminal",
			workspaceId: "workspace",
			executionId: "execution",
			...(marked ? { replaying: true } : {}),
		}),
	);
	emit(new TextEncoder().encode("query"));
	emit(JSON.stringify({ type: "replay-complete" }));
	emit(new TextEncoder().encode("live"));
	expect(writes).toEqual(
		marked
			? ["begin", "history:query", "end", "live:live"]
			: ["live:query", "live:live"],
	);
});

const connection: DirectDescriptor = {
	connectionId: "machine",
	generation: 1,
	backendId: "backend",
	namespaceId: "namespace",
	instanceId: "instance",
};

async function pendingFixture(strict: boolean) {
	let listener!: (event: DirectSocketEvent) => void;
	let socketId = "";
	const sent: { type: string; data?: string }[] = [];
	const terminals: HeadlessTerminal[] = [];
	const open = async (_connection: unknown, _ref: unknown, id: string) => {
		socketId = id;
	};
	const api = {
		onSocket(callback: typeof listener) {
			listener = callback;
			return () => {};
		},
		openRestoredTerminal: open,
		openSocket: open,
		async sendSocket(_id: string, data: string) {
			sent.push(JSON.parse(data));
		},
		async closeSocket() {},
	} as unknown as DirectWorkstationApi;
	const props = {
		api,
		connection,
		terminalId: "terminal",
		restoreRef: strict
			? {
					kind: "terminal" as const,
					workspaceId: "workspace",
					resourceId: "terminal",
					executionId: "execution",
				}
			: undefined,
		onError() {},
		createEmulator() {
			const terminal = new HeadlessTerminal({ allowProposedApi: true });
			terminals.push(terminal);
			return { terminal, fit() {} };
		},
	};
	const view = render(<RemoteTerminal {...props} />);
	await waitFor(() => expect(socketId).not.toBe(""));
	return {
		sent,
		view,
		props,
		current: () => ({ listener, socketId, terminal: terminals.at(-1)! }),
	};
}

test.each([
	true,
	false,
])("only queued user input is sent after the existing attached message (strict=%s)", async (strict) => {
	const f = await pendingFixture(strict);
	const { terminal, listener, socketId } = f.current();
	act(() => terminal.input("before ", true));
	act(() => listener({ socketId, kind: "open" }));
	act(() => terminal.input("typed 中文", true));
	act(() => terminal.input("\x1bP>|xterm.js(old)\x1b\\", false));
	act(() => terminal.input("\r", true));
	expect(f.sent).toEqual([]);
	const attach = () =>
		listener({
			socketId,
			kind: "message",
			data: JSON.stringify({
				type: "attached",
				terminalId: "terminal",
				...(strict
					? { workspaceId: "workspace", executionId: "execution" }
					: {}),
			}),
		});
	act(attach);
	expect(f.sent.filter((m) => m.type === "input")).toEqual([
		{ type: "input", data: "before typed 中文\r" },
	]);
	expect(f.sent.at(-1)?.type).toBe("input");
	act(attach);
	expect(f.sent.filter((m) => m.type === "input")).toHaveLength(1);
	act(() => terminal.input("\x1b[1;1R", false));
	expect(f.sent.at(-1)).toEqual({ type: "input", data: "\x1b[1;1R" });
});

test.each([
	"mismatch",
	"close",
	"exit",
	"unmount",
	"switch",
] as const)("queued direct input cannot survive %s", async (action) => {
	const f = await pendingFixture(true);
	const old = f.current();
	act(() => old.terminal.input("old command\r", true));
	const attached = {
		type: "attached",
		terminalId: "terminal",
		workspaceId: "workspace",
		executionId: "execution",
	};
	if (action === "mismatch")
		act(() =>
			old.listener({
				socketId: old.socketId,
				kind: "message",
				data: JSON.stringify({ ...attached, executionId: "replacement" }),
			}),
		);
	if (action === "close")
		act(() => old.listener({ socketId: old.socketId, kind: "close" }));
	if (action === "exit")
		act(() =>
			old.listener({
				socketId: old.socketId,
				kind: "message",
				data: JSON.stringify({ type: "exit", exitCode: 0 }),
			}),
		);
	if (action === "unmount") f.view.unmount();
	if (action === "switch")
		f.view.rerender(
			<RemoteTerminal
				{...f.props}
				connection={{ ...connection, generation: 2 }}
			/>,
		);
	act(() =>
		old.listener({
			socketId: old.socketId,
			kind: "message",
			data: JSON.stringify(attached),
		}),
	);
	if (action === "switch") {
		await waitFor(() => expect(f.current().socketId).not.toBe(old.socketId));
		const current = f.current();
		act(() => current.terminal.input("fresh\r", true));
		act(() =>
			current.listener({
				socketId: current.socketId,
				kind: "message",
				data: JSON.stringify(attached),
			}),
		);
		expect(f.sent.filter((m) => m.type === "input")).toEqual([
			{ type: "input", data: "fresh\r" },
		]);
	} else expect(f.sent.filter((m) => m.type === "input")).toEqual([]);
});

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
	act(() =>
		listener({
			socketId: calls[0],
			kind: "message",
			data: JSON.stringify({ type: "attached", terminalId: "terminal" }),
		}),
	);
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

test("file links use the owning backend and revoke old navigation after workspace changes", async () => {
	const handlers: import("renderer/lib/terminal/terminal-link-manager").TerminalLinkHandlers[] =
		[];
	const calls: unknown[] = [];
	const opened: unknown[] = [];
	let finish!: (value: unknown) => void;
	let defer = false;
	let reviewing = false;
	const api = {
		onSocket: () => () => {},
		openRestoredTerminal: async () => {},
		closeSocket: async () => {},
		rpc: async (request: unknown) => {
			calls.push(request);
			if (defer)
				return new Promise((resolve) => {
					finish = resolve;
				});
			return { resolvedPath: "/remote/note.txt", isDirectory: false };
		},
	} as unknown as DirectWorkstationApi;
	const createEmulator = (): TerminalEmulator => ({
		terminal: {
			cols: 80,
			rows: 24,
			write() {},
			writeln() {},
			dispose() {},
			onData: () => ({ dispose() {} }),
			onResize: () => ({ dispose() {} }),
		},
		fit() {},
		installLinkHandlers(value) {
			handlers.push(value);
			return () => {};
		},
		isReviewing: () => reviewing,
	});
	const renderTerminal = (workspaceId: string, descriptor = connection) => (
		<RemoteTerminal
			api={api}
			connection={{ ...descriptor, capabilities: { workstationFilesV1: true } }}
			terminalId="terminal"
			restoreRef={{
				workspaceId,
				kind: "terminal",
				resourceId: "terminal",
				executionId: "execution",
			}}
			onError={(error) => {
				throw new Error(error);
			}}
			onOpenFile={(value) => opened.push(value)}
			createEmulator={createEmulator}
		/>
	);
	const view = render(renderTerminal("workspace"));
	expect(handlers).toHaveLength(1);
	const original = handlers[0];
	if (!original?.stat || !original.onFileLinkClick)
		throw new Error("File handlers missing");
	expect(await original.stat("note.txt")).toEqual({
		resolvedPath: "/remote/note.txt",
		isDirectory: false,
	});
	expect(calls).toEqual([
		{
			connectionId: "machine",
			generation: 1,
			path: "filesystem.statPath",
			type: "mutation",
			input: { workspaceId: "workspace", path: "note.txt" },
		},
	]);
	const link = {
		text: "note.txt:3",
		startIndex: 0,
		endIndex: 10,
		resolvedPath: "/remote/note.txt",
		isDirectory: false,
		row: 3,
		col: 2,
		rowEnd: undefined,
		colEnd: undefined,
	};
	original.onFileLinkClick(new MouseEvent("click"), link);
	expect(opened).toEqual([]);
	original.onFileLinkClick(new MouseEvent("click", { metaKey: true }), link);
	expect(opened).toEqual([
		{ absolutePath: "/remote/note.txt", line: 3, column: 2 },
	]);
	reviewing = true;
	original.onFileLinkClick(new MouseEvent("click", { ctrlKey: true }), link);
	expect(opened).toHaveLength(1);
	reviewing = false;
	original.onFileLinkClick(new MouseEvent("click", { ctrlKey: true }), {
		...link,
		isDirectory: true,
	});
	expect(opened).toHaveLength(1);
	defer = true;
	const pending = original.stat("delayed.txt");
	view.rerender(
		renderTerminal("other", {
			...connection,
			namespaceId: "other",
			generation: 2,
		}),
	);
	finish({ resolvedPath: "/remote/delayed.txt", isDirectory: false });
	expect(await pending).toBeNull();
	original.onFileLinkClick(new MouseEvent("click", { ctrlKey: true }), link);
	expect(opened).toHaveLength(1);
	const count = calls.length;
	expect(await original.stat("old.txt")).toBeNull();
	expect(calls).toHaveLength(count);
	defer = false;
	view.unmount();
	const last = handlers.at(-1);
	if (!last?.stat) throw new Error("Final file handler missing");
	expect(await last.stat("after-unmount.txt")).toBeNull();
});
