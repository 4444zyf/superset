import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

export interface TerminalEmulator {
	terminal: Pick<
		Terminal,
		"cols" | "rows" | "write" | "writeln" | "onData" | "onResize" | "dispose"
	>;
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
	onError,
	createEmulator = createXterm,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	terminalId: string;
	onError(message: string): void;
	createEmulator?(element: HTMLDivElement): TerminalEmulator;
}) {
	const element = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!element.current) return;
		const { terminal, fit } = createEmulator(element.current);
		fit();
		const socketId = crypto.randomUUID();
		let closed = false;
		let ready = false;
		const send = (data: unknown) => {
			if (ready && !closed)
				void api
					.sendSocket(socketId, JSON.stringify(data))
					.catch((error) => onError(String(error)));
		};
		const off = api.onSocket((event) => {
			if (event.socketId !== socketId || closed) return;
			if (event.kind === "open") {
				ready = true;
				send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
				send({ type: "visible", visible: true });
				send({ type: "focus", focused: true });
			}
			if (event.kind === "message") {
				if (event.data instanceof Uint8Array) terminal.write(event.data);
				else if (typeof event.data === "string") {
					try {
						const message = JSON.parse(event.data);
						if (message.type === "ping") send({ type: "pong" });
						if (message.type === "error") onError(message.message);
						if (message.type === "exit")
							terminal.writeln(`\r\n[exit ${message.exitCode}]`);
					} catch {}
				}
			}
			if (event.kind === "close" || event.kind === "error") ready = false;
		});
		const input = terminal.onData((data) => send({ type: "input", data }));
		const resize = terminal.onResize(({ cols, rows }) =>
			send({ type: "resize", cols, rows }),
		);
		const observer = new ResizeObserver(fit);
		observer.observe(element.current);
		void api
			.openSocket(connection, `/terminal/${terminalId}`, socketId)
			.then(() => {
				if (closed) return api.closeSocket(socketId).catch(() => {});
			})
			.catch((error) => {
				if (!closed) onError(String(error));
			});
		return () => {
			closed = true;
			off();
			input.dispose();
			resize.dispose();
			observer.disconnect();
			void api.closeSocket(socketId).catch(() => {});
			terminal.dispose();
		};
	}, [api, connection, terminalId, onError, createEmulator]);
	return (
		<div
			ref={element}
			className="h-[360px] border border-zinc-700 rounded p-2"
		/>
	);
}
