import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { RestoreResourceRef } from "@superset/shared/workspace-restore";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

export interface TerminalEmulator {
	terminal: Pick<
		Terminal,
		"cols" | "rows" | "write" | "writeln" | "onData" | "onResize" | "dispose"
	> & { focus?(): void };
	fit(): void;
}

function createXterm(element: HTMLDivElement): TerminalEmulator {
	const terminal = new Terminal({
		fontSize: 13,
		scrollback: 3000,
		theme: { background: "#09090b" },
	});
	const addon = new FitAddon();
	terminal.loadAddon(addon);
	terminal.open(element);
	return { terminal, fit: () => addon.fit() };
}

export function RemoteTerminal({
	api,
	connection,
	terminalId,
	restoreRef,
	focused = true,
	visible = true,
	fill = false,
	onAttached,
	onExited,
	onError,
	createEmulator = createXterm,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	terminalId: string;
	restoreRef?: RestoreResourceRef;
	focused?: boolean;
	visible?: boolean;
	fill?: boolean;
	onAttached?(): void;
	onExited?(): void;
	onError(message: string): void;
	createEmulator?(element: HTMLDivElement): TerminalEmulator;
}) {
	const element = useRef<HTMLDivElement>(null);
	const focus = useRef(focused);
	focus.current = focused;
	const focusTerminal = useRef<(() => void) | null>(null);
	const [state, setState] = useState("pending");
	const callbacks = useRef({ onError, onAttached, onExited });
	callbacks.current = { onError, onAttached, onExited };
	useEffect(() => {
		if (!element.current || !visible) return;
		setState("pending");
		const { terminal, fit } = createEmulator(element.current);
		fit();
		const socketId = crypto.randomUUID();
		let closed = false;
		let ready = false;
		let ended = false;
		let attachTimer: ReturnType<typeof setTimeout> | undefined;
		const send = (data: unknown) => {
			if (ready && !closed)
				void api
					.sendSocket(socketId, JSON.stringify(data))
					.catch((error) => callbacks.current.onError(String(error)));
		};
		const announce = () => {
			send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
			send({ type: "visible", visible: true });
			send({ type: "focus", focused: focus.current });
			if (focus.current) terminal.focus?.();
		};
		focusTerminal.current = () => {
			if (ready && !closed) {
				send({ type: "focus", focused: focus.current });
				if (focus.current) terminal.focus?.();
			}
		};
		const off = api.onSocket((event) => {
			if (event.socketId !== socketId || closed) return;
			if (event.kind === "open") {
				if (!restoreRef) {
					ready = true;
					setState("attached");
					announce();
				}
			}
			if (event.kind === "message") {
				if (event.data instanceof Uint8Array) {
					if (ready || !restoreRef) terminal.write(event.data);
				} else if (typeof event.data === "string") {
					try {
						const message = JSON.parse(event.data);
						if (message.type === "attached" && restoreRef && !ready) {
							if (
								message.terminalId !== terminalId ||
								message.workspaceId !== restoreRef.workspaceId ||
								message.executionId !== restoreRef.executionId
							) {
								closed = true;
								setState("unknown");
								clearTimeout(attachTimer);
								void api.closeSocket(socketId).catch(() => {});
								callbacks.current.onError("EXECUTION_CHANGED");
								return;
							}
							ready = true;
							setState("attached");
							clearTimeout(attachTimer);
							announce();
							callbacks.current.onAttached?.();
						}
						if (message.type === "ping") send({ type: "pong" });
						if (message.type === "error") {
							ready = false;
							setState("unknown");
							clearTimeout(attachTimer);
							callbacks.current.onError(message.code ?? message.message);
						}
						if (message.type === "exit") {
							ended = true;
							callbacks.current.onExited?.();
							ready = false;
							setState("ended");
							clearTimeout(attachTimer);
							terminal.writeln(`\r\n[exit ${message.exitCode}]`);
						}
					} catch {}
				}
			}
			if (event.kind === "close" || event.kind === "error") {
				ready = false;
				clearTimeout(attachTimer);
				if (restoreRef && !ended)
					callbacks.current.onError("RESTORE_UNAVAILABLE");
			}
		});
		const input = terminal.onData((data) => {
			if (focus.current) send({ type: "input", data });
		});
		const resize = terminal.onResize(({ cols, rows }) =>
			send({ type: "resize", cols, rows }),
		);
		const observer = new ResizeObserver(fit);
		observer.observe(element.current);
		if (restoreRef)
			attachTimer = setTimeout(() => {
				if (!ready && !closed) {
					closed = true;
					setState("unknown");
					void api.closeSocket(socketId).catch(() => {});
					callbacks.current.onError("RESTORE_UNAVAILABLE");
				}
			}, 10000);
		const opening = restoreRef
			? (api.openRestoredTerminal?.(connection, restoreRef, socketId) ??
				Promise.reject(new Error("Strict restore is unsupported")))
			: api.openSocket(connection, `/terminal/${terminalId}`, socketId);
		void opening
			.then(() => {
				if (closed) return api.closeSocket(socketId).catch(() => {});
			})
			.catch((error) => {
				clearTimeout(attachTimer);
				if (!closed) {
					setState("unknown");
					callbacks.current.onError(String(error));
				}
			});
		return () => {
			closed = true;
			clearTimeout(attachTimer);
			focusTerminal.current = null;
			off();
			input.dispose();
			resize.dispose();
			observer.disconnect();
			void api.closeSocket(socketId).catch(() => {});
			terminal.dispose();
		};
	}, [
		api,
		connection,
		terminalId,
		restoreRef?.workspaceId,
		restoreRef?.executionId,
		visible,
		createEmulator,
	]);
	useEffect(() => {
		focusTerminal.current?.();
	}, [focused]);
	return (
		<div
			ref={element}
			data-terminal-id={terminalId}
			data-execution-id={restoreRef?.executionId}
			data-restore-state={state}
			className={
				fill
					? "h-full min-h-0 p-2"
					: "h-[360px] border border-zinc-700 rounded p-2"
			}
		/>
	);
}
