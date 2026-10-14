import { darkTheme, getTerminalColors } from "@superset/shared/themes";
import type { RestoreResourceRef } from "@superset/shared/workspace-restore";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	resolveTerminalAppearance,
	type TerminalAppearance,
} from "renderer/lib/terminal/appearance";
import { createTerminalSurface } from "renderer/lib/terminal/createTerminalSurface";
import { writeTerminalClipboard } from "renderer/lib/terminal/terminal-clipboard";
import { installCopyOnSelect } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/hooks/useCopyOnSelect/copyOnSelect";
import { TerminalSearch } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/TerminalSearch";
import { toXtermTheme } from "renderer/stores/theme/utils";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { useWorkstationAppearance } from "../../providers/WorkstationPreferencesContext";

export interface TerminalEmulator {
	terminal: Pick<
		Terminal,
		"cols" | "rows" | "write" | "writeln" | "onData" | "onResize" | "dispose"
	> & { focus?(): void };
	fit(): void;
	searchAddon?: SearchAddon;
	cleanup?(): void;
	applyAppearance?(appearance: TerminalAppearance): void;
	installCopyOnSelect?(writeText: (text: string) => Promise<void>): () => void;
}

function createXterm(element: HTMLDivElement): TerminalEmulator {
	const surface = createTerminalSurface({
		initialTheme: toXtermTheme(getTerminalColors(darkTheme)),
	});
	element.appendChild(surface.wrapper);
	if (surface.xterm.element) surface.xterm.element.style.padding = "8px";
	return {
		terminal: surface.xterm,
		fit: () => surface.fitAddon.fit(),
		searchAddon: surface.searchAddon,
		applyAppearance: surface.applyAppearance,
		installCopyOnSelect: (writeText) =>
			installCopyOnSelect(surface.xterm, undefined, writeText),
		cleanup: () => {
			surface.cleanup();
			surface.wrapper.remove();
		},
	};
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
	const { theme, fontSettings, copyOnSelect } = useWorkstationAppearance();
	const appearance = useMemo(
		() =>
			resolveTerminalAppearance(
				toXtermTheme(getTerminalColors(theme)),
				fontSettings,
			),
		[theme, fontSettings],
	);
	const emulatorRef = useRef<TerminalEmulator | null>(null);
	const appearanceRef = useRef(appearance);
	appearanceRef.current = appearance;
	const workspaceId = restoreRef?.workspaceId;
	const resourceId = restoreRef?.resourceId;
	const executionId = restoreRef?.executionId;
	const restoreTarget = useMemo(
		() =>
			workspaceId && resourceId
				? { kind: "terminal" as const, workspaceId, resourceId, executionId }
				: undefined,
		[workspaceId, resourceId, executionId],
	);
	const element = useRef<HTMLDivElement>(null);
	const focus = useRef(focused);
	focus.current = focused;
	const focusTerminal = useRef<(() => void) | null>(null);
	const [state, setState] = useState("pending");
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
	const callbacks = useRef({ onError, onAttached, onExited });
	callbacks.current = { onError, onAttached, onExited };
	useEffect(() => {
		if (!element.current || !visible) return;
		setState("pending");
		const emulator = createEmulator(element.current);
		emulatorRef.current = emulator;
		emulator.applyAppearance?.(appearanceRef.current);
		const { terminal, fit, searchAddon, cleanup } = emulator;
		setSearchAddon(searchAddon ?? null);
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
				if (!restoreTarget) {
					ready = true;
					setState("attached");
					announce();
				}
			}
			if (event.kind === "message") {
				if (event.data instanceof Uint8Array) {
					if (ready || !restoreTarget) terminal.write(event.data);
				} else if (typeof event.data === "string") {
					try {
						const message = JSON.parse(event.data);
						if (message.type === "attached" && restoreTarget && !ready) {
							if (
								message.terminalId !== terminalId ||
								message.workspaceId !== restoreTarget.workspaceId ||
								message.executionId !== restoreTarget.executionId
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
				if (restoreTarget && !ended)
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
		if (restoreTarget)
			attachTimer = setTimeout(() => {
				if (!ready && !closed) {
					closed = true;
					setState("unknown");
					void api.closeSocket(socketId).catch(() => {});
					callbacks.current.onError("RESTORE_UNAVAILABLE");
				}
			}, 10000);
		const opening = restoreTarget
			? (api.openRestoredTerminal?.(connection, restoreTarget, socketId) ??
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
			emulatorRef.current = null;
			cleanup?.();
			terminal.dispose();
		};
	}, [api, connection, terminalId, restoreTarget, visible, createEmulator]);
	useEffect(() => {
		emulatorRef.current?.applyAppearance?.(appearance);
	}, [appearance]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reconnect replaces the emulator held in the ref
	useEffect(() => {
		if (!copyOnSelect || !visible) return;
		return emulatorRef.current?.installCopyOnSelect?.((text) =>
			writeTerminalClipboard(text, async (value) => {
				if (!api.copyText) throw new Error("Native clipboard is unavailable");
				await api.copyText(value);
			}),
		);
	}, [
		api,
		connection,
		terminalId,
		restoreTarget,
		visible,
		createEmulator,
		copyOnSelect,
	]);
	useEffect(() => {
		focus.current = focused;
		focusTerminal.current?.();
	}, [focused]);
	return (
		<div
			className="relative h-full min-h-0"
			onKeyDownCapture={(event) => {
				if (
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "f" &&
					searchAddon
				) {
					event.preventDefault();
					event.stopPropagation();
					setSearchOpen(true);
				}
			}}
		>
			<div
				ref={element}
				data-terminal-id={terminalId}
				data-execution-id={restoreRef?.executionId}
				data-restore-state={state}
				className={
					fill
						? "h-full min-h-0 overflow-hidden"
						: "h-[360px] border border-zinc-700 rounded p-2"
				}
			/>
			<TerminalSearch
				searchAddon={searchAddon}
				isOpen={searchOpen}
				onClose={() => {
					setSearchOpen(false);
					focusTerminal.current?.();
				}}
			/>
		</div>
	);
}
