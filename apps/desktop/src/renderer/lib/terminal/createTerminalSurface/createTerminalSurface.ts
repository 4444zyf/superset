import { installTerminalWheelEventHandler } from "@superset/shared/terminal-wheel-handler";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import { applyTerminalFontFamilyCssVariable } from "renderer/lib/terminal/appearance";
import { Utf8Base64 } from "renderer/lib/terminal/clipboard-base64";
import { FocusAwareClipboardProvider } from "renderer/lib/terminal/clipboard-provider";
import {
	createParserIdleGate,
	type ParserIdleGate,
	wrapWrite,
} from "renderer/lib/terminal/parser-idle-gate";
import { TerminalLinkManager } from "renderer/lib/terminal/terminal-link-manager";
import { installInputModeReclaimer } from "renderer/lib/terminal/terminalInputModeReclaimer";

import {
	DEFAULT_TERMINAL_FONT_FAMILY,
	TERMINAL_OPTIONS,
} from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/config";
import { suppressQueryResponses } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/suppressQueryResponses";

let suggestedRendererType: "webgl" | "dom" | undefined;

export function createTerminalSurface(options: { initialTheme: ITheme }): {
	xterm: XTerm;
	fitAddon: FitAddon;
	searchAddon: SearchAddon;
	gate: ParserIdleGate;
	wrapper: HTMLDivElement;
	linkManager: TerminalLinkManager;
	cleanup: () => void;
} {
	const { initialTheme } = options;

	const theme = initialTheme;
	const terminalOptions = { ...TERMINAL_OPTIONS, theme };
	const xterm = new XTerm(terminalOptions);
	const gate = createParserIdleGate();
	xterm.write = wrapWrite(gate, xterm.write.bind(xterm));
	const fitAddon = new FitAddon();
	const searchAddon = new SearchAddon();

	// Utf8Base64 replaces the addon's UTF-8-unsafe default codec (#4839).
	const clipboardAddon = new ClipboardAddon(
		new Utf8Base64(),
		new FocusAwareClipboardProvider(),
	);
	const unicode11Addon = new Unicode11Addon();
	const imageAddon = new ImageAddon();

	let disposed = false;
	let webglAddon: WebglAddon | null = null;

	// Open into a detached wrapper div — not the live container.
	const wrapper = document.createElement("div");
	wrapper.style.width = "100%";
	wrapper.style.height = "100%";
	applyTerminalFontFamilyCssVariable(
		wrapper,
		terminalOptions.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
	);
	xterm.open(wrapper);

	xterm.loadAddon(fitAddon);
	xterm.loadAddon(searchAddon);
	xterm.loadAddon(clipboardAddon);
	xterm.loadAddon(unicode11Addon);
	xterm.loadAddon(imageAddon);

	try {
		xterm.loadAddon(new LigaturesAddon());
	} catch {
		// Ligatures not supported by current font
	}

	// Defer WebGL to rAF to avoid racing xterm's post-open viewport sync.
	const rafId = requestAnimationFrame(() => {
		if (disposed || suggestedRendererType === "dom") return;

		try {
			webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon?.dispose();
				webglAddon = null;
				suggestedRendererType = "dom";
				xterm.refresh(0, xterm.rows - 1);
			});
			xterm.loadAddon(webglAddon);
		} catch {
			suggestedRendererType = "dom";
			webglAddon = null;
		}
	});

	const cleanupQuerySuppression = suppressQueryResponses(xterm);
	const uninstallWheelHandler = installTerminalWheelEventHandler(xterm);
	// Disarm TUI-only input modes (kitty keyboard / mouse / focus) leaked into a
	// live shell prompt by a TUI killed while attached (#4949) — keyed on the
	// OSC 777 shell-ready marker, same as v2's terminal-runtime.
	const inputModeReclaimer = installInputModeReclaimer(xterm);

	const linkManager = new TerminalLinkManager(xterm);

	xterm.unicode.activeVersion = "11";

	return {
		xterm,
		fitAddon,
		searchAddon,
		gate,
		wrapper,
		linkManager,
		cleanup: () => {
			disposed = true;
			cancelAnimationFrame(rafId);
			cleanupQuerySuppression();
			uninstallWheelHandler();
			inputModeReclaimer.dispose();
			linkManager.dispose();
			try {
				webglAddon?.dispose();
			} catch {}
			webglAddon = null;
		},
	};
}
