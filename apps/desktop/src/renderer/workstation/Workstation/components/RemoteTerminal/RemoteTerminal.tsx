import { Trans } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { setTerminalBinaryInputSupported } from "@superset/shared/terminal-wheel-handler";
import { darkTheme, getTerminalColors } from "@superset/shared/themes";
import type { RestoreResourceRef } from "@superset/shared/workspace-restore";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	resolveTerminalAppearance,
	type TerminalAppearance,
} from "renderer/lib/terminal/appearance";
import { validateClipboardFiles } from "renderer/lib/terminal/clipboard-files";
import { createTerminalSurface } from "renderer/lib/terminal/createTerminalSurface";
import { writeTerminalClipboard } from "renderer/lib/terminal/terminal-clipboard";
import {
	getTerminalSelectionForCopy,
	installTerminalCopyHandler,
} from "renderer/lib/terminal/terminal-copy";
import { installImagePasteFallback } from "renderer/lib/terminal/terminal-image-paste-fallback";
import { installTerminalKeyEventHandler } from "renderer/lib/terminal/terminal-key-event-handler-core";
import type { TerminalLinkHandlers } from "renderer/lib/terminal/terminal-link-manager";
import {
	listenTerminalInput,
	TerminalPendingInput,
} from "renderer/lib/terminal/terminal-pending-input";
import { createTerminalReplayGate } from "renderer/lib/terminal/terminal-replay-gate";
import { installCopyOnSelect } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/hooks/useCopyOnSelect/copyOnSelect";
import { shellEscapePaths } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/utils";
import { uploadPastedFiles } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/utils/uploadPastedFiles";
import { TerminalSearch } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/TerminalSearch";
import { toXtermTheme } from "renderer/stores/theme/utils";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { useWorkstationAppearance } from "../../providers/WorkstationPreferencesContext";
import {
	type TerminalFileTarget,
	terminalFileLinks,
} from "./utils/terminal-file-links/terminal-file-links";

export interface TerminalClipboardControls {
	canCopy(): boolean;
	canPaste(): boolean;
	copy(): void;
	paste(): void;
}

export interface TerminalEmulator {
	terminal: Pick<
		Terminal,
		"cols" | "rows" | "write" | "writeln" | "onData" | "onResize" | "dispose"
	> & { focus?(): void } & Partial<
			Pick<Terminal, "input" | "paste" | "onBinary">
		>;
	fit(): void;
	searchAddon?: SearchAddon;
	cleanup?(): void;
	applyAppearance?(appearance: TerminalAppearance): void;
	installCopyOnSelect?(writeText: (text: string) => Promise<void>): () => void;
	installCopyHandler?(writeText: (text: string) => Promise<void>): () => void;
	getSelectionForCopy?(): string;
	installLinkHandlers?(handlers: TerminalLinkHandlers): () => void;
	isReviewing?(): boolean;
	beginReplay?(): void;
	endReplay?(): void;
	writeReplay?(data: Uint8Array): void;
}

function createXterm(element: HTMLDivElement): TerminalEmulator {
	const replay = createTerminalReplayGate();
	const surface = createTerminalSurface({
		initialTheme: toXtermTheme(getTerminalColors(darkTheme)),
		versionReplyOptions: replay.versionReplyOptions,
	});
	const removeKeys = installTerminalKeyEventHandler(surface.xterm, {
		linuxCtrlVPaste: true,
	});
	element.appendChild(surface.wrapper);
	if (surface.xterm.element) surface.xterm.element.style.padding = "8px";
	return {
		terminal: surface.xterm,
		fit: () => surface.fitAddon.fit(),
		searchAddon: surface.searchAddon,
		beginReplay: replay.begin,
		endReplay: replay.end,
		writeReplay: (data) =>
			replay.write(data, (chunk, done) => surface.xterm.write(chunk, done)),
		applyAppearance: surface.applyAppearance,
		installCopyHandler: (writeText) =>
			installTerminalCopyHandler(surface.xterm, writeText),
		installCopyOnSelect: (writeText) =>
			installCopyOnSelect(surface.xterm, undefined, writeText),
		getSelectionForCopy: () =>
			surface.wrapper.querySelector("[data-terminal-scrollback-review]")
				? (window.getSelection()?.toString() ?? "")
				: getTerminalSelectionForCopy(surface.xterm),
		installLinkHandlers: (handlers) => {
			surface.linkManager.setHandlers(handlers);
			return () => surface.linkManager.dispose();
		},
		isReviewing: () =>
			!!surface.wrapper.querySelector("[data-terminal-scrollback-review]"),
		cleanup: () => {
			removeKeys();
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
	onOpenFile,
	onClipboardControls,
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
	onOpenFile?(target: TerminalFileTarget): void;
	onClipboardControls?(controls: TerminalClipboardControls): () => void;
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
	const [pasteBusy, setPasteBusy] = useState(false);
	const [pasteError, setPasteError] = useState<string | null>(null);
	const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
	const clipboardControls = useRef<TerminalClipboardControls | null>(null);
	const callbacks = useRef({
		onError,
		onAttached,
		onExited,
		onClipboardControls,
	});
	callbacks.current = { onError, onAttached, onExited, onClipboardControls };
	const navigation = useRef({
		api,
		connection,
		workspaceId,
		terminalId,
		executionId,
		visible,
		onOpenFile,
	});
	navigation.current = {
		api,
		connection,
		workspaceId,
		terminalId,
		executionId,
		visible,
		onOpenFile,
	};
	useEffect(() => {
		if (!element.current || !visible) return;
		setState("pending");
		setPasteBusy(false);
		setPasteError(null);
		const emulator = createEmulator(element.current);
		emulatorRef.current = emulator;
		emulator.applyAppearance?.(appearanceRef.current);
		const { terminal, fit, searchAddon, cleanup } = emulator;
		const writeCopy = (text: string) =>
			writeTerminalClipboard(text, async (value) => {
				if (!api.copyText) throw new Error("Native clipboard is unavailable");
				await api.copyText(value);
			});
		const removeCopy = emulator.installCopyHandler?.(writeCopy);
		setSearchAddon(searchAddon ?? null);
		fit();
		const socketId = crypto.randomUUID();
		let closed = false;
		let ready = false;
		let binaryInput = false;
		setTerminalBinaryInputSupported(terminal, false);
		let receivingReplay = false;
		let ended = false;
		let connecting = true;
		const pendingInput = new TerminalPendingInput();
		const cancelPendingInput = () => {
			connecting = false;
			pendingInput.clear();
		};
		const removeLinks = workspaceId
			? emulator.installLinkHandlers?.(
					terminalFileLinks({
						api,
						connection,
						workspaceId,
						isCurrent: () =>
							!closed &&
							navigation.current.api === api &&
							navigation.current.connection === connection &&
							navigation.current.workspaceId === workspaceId &&
							navigation.current.terminalId === terminalId &&
							navigation.current.executionId === executionId &&
							navigation.current.visible &&
							!!navigation.current.onOpenFile,
						isReviewing: () => emulator.isReviewing?.() ?? false,
						onOpenFile: (target) => navigation.current.onOpenFile?.(target),
					}),
				)
			: undefined;
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
			if (event.kind === "message") {
				if (event.data instanceof Uint8Array) {
					if (ready || !restoreTarget) {
						if (receivingReplay && emulator.writeReplay)
							emulator.writeReplay(event.data);
						else terminal.write(event.data);
					}
				} else if (typeof event.data === "string") {
					try {
						const message = JSON.parse(event.data);
						if (message.type === "attached" && !ready) {
							if (
								message.terminalId !== terminalId ||
								(restoreTarget &&
									(message.workspaceId !== restoreTarget.workspaceId ||
										message.executionId !== restoreTarget.executionId))
							) {
								closed = true;
								cancelPendingInput();
								setState("unknown");
								clearTimeout(attachTimer);
								void api.closeSocket(socketId).catch(() => {});
								callbacks.current.onError("EXECUTION_CHANGED");
								return;
							}
							if (restoreTarget && message.replaying === true) {
								receivingReplay = true;
								emulator.beginReplay?.();
							}
							binaryInput = message.binaryInput === true;
							setTerminalBinaryInputSupported(terminal, binaryInput);
							ready = true;
							connecting = false;
							setState("attached");
							clearTimeout(attachTimer);
							announce();
							const pending = pendingInput.take();
							if (
								pending &&
								focus.current &&
								navigation.current.connection === connection &&
								navigation.current.terminalId === terminalId &&
								navigation.current.executionId === executionId
							)
								send({ type: "input", data: pending });
							callbacks.current.onAttached?.();
						}
						if (message.type === "ping") send({ type: "pong" });
						if (message.type === "replay-complete" && receivingReplay) {
							receivingReplay = false;
							emulator.endReplay?.();
						}
						if (message.type === "error") {
							cancelPendingInput();
							ready = false;
							setState("unknown");
							clearTimeout(attachTimer);
							callbacks.current.onError(message.code ?? message.message);
						}
						if (message.type === "exit") {
							cancelPendingInput();
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
				cancelPendingInput();
				ready = false;
				clearTimeout(attachTimer);
				if (restoreTarget && !ended)
					callbacks.current.onError("RESTORE_UNAVAILABLE");
			}
		});
		let uploading = false;
		const removePaste = terminal.input
			? installImagePasteFallback(
					{ input: terminal.input.bind(terminal) },
					element.current,
					() => (files) => {
						if (!ready || closed || ended || !focus.current || uploading)
							return;
						uploading = true;
						setPasteBusy(true);
						setPasteError(null);
						const current = () => ready && !closed && !ended && focus.current;
						void (async () => {
							validateClipboardFiles(files);
							if (
								!workspaceId ||
								!connection.capabilities?.workstationFilesV1 ||
								!terminal.paste
							)
								throw new Error(
									"This backend does not support the required capability",
								);
							const workspace = await api.rpc<{ worktreePath: string }>({
								connectionId: connection.connectionId,
								generation: connection.generation,
								path: "workspace.get",
								type: "query",
								input: { id: workspaceId },
							});
							if (!current()) return;
							const rpc = <T,>(path: string, input: unknown) => {
								if (!current())
									return Promise.reject(
										new Error(
											"Connection changed; reconnect before continuing",
										),
									);
								return api.rpc<T>({
									connectionId: connection.connectionId,
									generation: connection.generation,
									path,
									type: "mutation",
									input,
								});
							};
							const paths = await uploadPastedFiles({
								workspaceId,
								worktreePath: workspace.worktreePath,
								files,
								deps: {
									createDirectory: (input) =>
										rpc("filesystem.createDirectory", input),
									writeFile: (input) => rpc("filesystem.writeFile", input),
								},
							});
							if (current())
								terminal.paste(
									shellEscapePaths(
										paths.map((path) => `${workspace.worktreePath}/${path}`),
									),
								);
						})()
							.catch((error) => {
								if (current()) setPasteError(errorMessage(error));
							})
							.finally(() => {
								uploading = false;
								if (!closed) setPasteBusy(false);
							});
					},
					{ preferFiles: true },
				)
			: undefined;
		const input = listenTerminalInput(
			terminal,
			(data, userInput) => {
				if (!focus.current || closed || ended) return;
				if (ready) send({ type: "input", data });
				else if (connecting && userInput) pendingInput.queue(data);
			},
			(data) => {
				if (binaryInput && ready && focus.current && !closed && !ended)
					send({ type: "input-binary", data: btoa(data) });
			},
		);
		const selection = () => emulator.getSelectionForCopy?.() ?? "";
		const clipboard: TerminalClipboardControls = {
			canCopy: () => !closed && !!selection(),
			canPaste: () =>
				ready &&
				!closed &&
				!ended &&
				!!api.pasteClipboard &&
				!emulator.isReviewing?.(),
			copy() {
				if (!clipboard.canCopy()) return;
				void writeCopy(selection())
					.catch((error) => {
						if (!closed) setPasteError(errorMessage(error));
					})
					.finally(() => {
						requestAnimationFrame(() => {
							if (!closed && focus.current) terminal.focus?.();
						});
					});
			},
			paste() {
				requestAnimationFrame(() => {
					if (!clipboard.canPaste() || !focus.current) return;
					terminal.focus?.();
					void api.pasteClipboard?.().catch((error) => {
						if (!closed) setPasteError(errorMessage(error));
					});
				});
			},
		};
		clipboardControls.current = clipboard;
		const removeClipboard = callbacks.current.onClipboardControls?.(clipboard);
		const resize = terminal.onResize(({ cols, rows }) =>
			send({ type: "resize", cols, rows }),
		);
		const observer = new ResizeObserver(fit);
		observer.observe(element.current);
		if (restoreTarget)
			attachTimer = setTimeout(() => {
				if (!ready && !closed) {
					cancelPendingInput();
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
				cancelPendingInput();
				clearTimeout(attachTimer);
				if (!closed) {
					setState("unknown");
					callbacks.current.onError(String(error));
				}
			});
		return () => {
			closed = true;
			removeClipboard?.();
			removeCopy?.();
			if (clipboardControls.current === clipboard)
				clipboardControls.current = null;
			cancelPendingInput();
			clearTimeout(attachTimer);
			focusTerminal.current = null;
			off();
			removeLinks?.();
			removePaste?.();
			input.dispose();
			resize.dispose();
			observer.disconnect();
			void api.closeSocket(socketId).catch(() => {});
			emulatorRef.current = null;
			cleanup?.();
			terminal.dispose();
		};
	}, [
		api,
		connection,
		terminalId,
		restoreTarget,
		visible,
		createEmulator,
		workspaceId,
		executionId,
	]);
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
					event.code === "KeyC" &&
					event.ctrlKey &&
					event.shiftKey &&
					!event.metaKey &&
					!event.altKey &&
					clipboardControls.current?.canCopy()
				) {
					event.preventDefault();
					event.stopPropagation();
					clipboardControls.current.copy();
				}
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
			{pasteError && (
				<output
					role="alert"
					className="absolute left-2 right-2 top-2 rounded bg-destructive/10 p-2 text-xs text-destructive"
				>
					{pasteError}
					<button
						type="button"
						className="ml-2 underline"
						onClick={() => {
							setPasteError(null);
							focusTerminal.current?.();
						}}
					>
						<Trans>Close</Trans>
					</button>
				</output>
			)}
			{pasteBusy && (
				<output
					className="absolute right-2 top-2 rounded bg-muted px-2 py-1 text-xs"
					aria-live="polite"
				>
					<Trans>Sending…</Trans>
				</output>
			)}
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
