import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import {
	getCellDimensions,
	installTerminalWheelEventHandler,
} from "@superset/shared/terminal-wheel-handler";
import type { IBuffer, Terminal } from "@xterm/xterm";
import { ScreenHistory } from "./screen-history";

function readLines(buffer: IBuffer, maxLines: number) {
	const lines: string[] = [];
	let budget = 1024 * 1024;
	for (
		let i = buffer.length - 1;
		i >= Math.max(0, buffer.length - maxLines) && budget > 0;
		i--
	) {
		const line = buffer.getLine(i)?.translateToString(true) ?? "";
		lines.push(line.slice(-budget));
		budget -= line.length + 1;
	}
	lines.reverse();
	while (lines.length && !lines[lines.length - 1]) lines.pop();
	return lines;
}

export function installTerminalWheelReview(terminal: Terminal): () => void {
	const history = new ScreenHistory();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let review: HTMLDivElement | undefined;
	let viewport: HTMLPreElement | undefined;
	let disposed = false;
	const capture = () => {
		if (!disposed && terminal.buffer.active.type === "alternate")
			history.capture(readLines(terminal.buffer.active, terminal.rows));
	};
	const close = (focus = true) => {
		const ownedFocus = Boolean(review?.contains(document.activeElement));
		review?.remove();
		review = undefined;
		viewport = undefined;
		if (focus && ownedFocus && !disposed) terminal.focus();
	};
	const move = (pixels: number) => {
		if (!viewport) return;
		viewport.scrollTop += pixels;
		if (
			pixels > 0 &&
			viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1
		)
			close();
	};
	const scroll = (lines: number) => {
		if (disposed || !terminal.element || !lines) return;
		const cellHeight =
			getCellDimensions(terminal)?.height ?? terminal.options.fontSize ?? 14;
		if (!review) {
			if (lines > 0) return;
			capture();
			review = document.createElement("div");
			review.dataset.terminalScrollbackReview = "true";
			review.tabIndex = 0;
			review.setAttribute("role", "region");
			review.setAttribute("aria-label", i18n._(msg({ message: "Terminal" })));
			Object.assign(review.style, {
				position: "absolute",
				inset: "0",
				zIndex: "10",
				background: terminal.options.theme?.background ?? "#1e1e1e",
				color: terminal.options.theme?.foreground ?? "#ffffff",
				overflow: "hidden",
			});
			viewport = document.createElement("pre");
			Object.assign(viewport.style, {
				margin: "0",
				padding: "8px",
				height: "100%",
				boxSizing: "border-box",
				overflow: "auto",
				overscrollBehavior: "contain",
				whiteSpace: "pre",
				fontFamily: terminal.options.fontFamily ?? "monospace",
				fontSize: `${terminal.options.fontSize ?? 14}px`,
				lineHeight: `${cellHeight}px`,
				letterSpacing: `${terminal.options.letterSpacing ?? 0}px`,
				userSelect: "text",
			});
			const normal = readLines(terminal.buffer.normal, 10000);
			viewport.textContent = [
				...normal,
				...(normal.length ? [""] : []),
				...history.lines(),
			].join("\n");
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = "×";
			button.setAttribute("aria-label", i18n._(msg({ message: "Close" })));
			Object.assign(button.style, {
				position: "absolute",
				right: "12px",
				top: "4px",
				fontSize: "24px",
				padding: "0 6px",
				cursor: "pointer",
				background: "inherit",
				color: "inherit",
			});
			button.addEventListener("click", () => close());
			review.append(viewport, button);
			review.addEventListener(
				"wheel",
				(event) => {
					event.preventDefault();
					event.stopImmediatePropagation();
					move(
						event.deltaY *
							(event.deltaMode === 1
								? cellHeight
								: event.deltaMode === 2
									? (viewport?.clientHeight ?? cellHeight)
									: 1),
					);
				},
				{ passive: false },
			);
			review.addEventListener("keydown", (event) => {
				if (event.key === "Escape" || event.key === "End") {
					event.preventDefault();
					event.stopImmediatePropagation();
					close();
				} else if (
					["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home"].includes(
						event.key,
					)
				) {
					event.preventDefault();
					event.stopImmediatePropagation();
					if (event.key === "Home" && viewport) viewport.scrollTop = 0;
					else
						move(
							(event.key.endsWith("Up") ? -1 : 1) *
								(event.key.startsWith("Page")
									? (viewport?.clientHeight ?? cellHeight)
									: cellHeight),
						);
				} else if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
			});
			for (const name of ["paste", "drop"] as const)
				review.addEventListener(name, (event) => {
					event.preventDefault();
					event.stopImmediatePropagation();
				});
			terminal.element.append(review);
			review.focus({ preventScroll: true });
			viewport.scrollTop = viewport.scrollHeight;
		}
		move(lines * cellHeight);
	};
	const parsed = terminal.onWriteParsed(() => {
		if (terminal.buffer.active.type !== "alternate" || timer !== undefined)
			return;
		timer = setTimeout(() => {
			timer = undefined;
			capture();
		}, 100);
	});
	const changed = terminal.buffer.onBufferChange((buffer) => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		if (buffer.type === "normal") {
			close();
			history.clear();
		}
	});
	const resized = terminal.onResize(() => close());
	const cleared = terminal.parser.registerCsiHandler(
		{ final: "J" },
		(params) => {
			if (params[0] === 3) {
				close();
				history.clear();
			}
			return false;
		},
	);
	const reset = terminal.parser.registerEscHandler({ final: "c" }, () => {
		close();
		history.clear();
		return false;
	});
	const uninstall = installTerminalWheelEventHandler(terminal, scroll);
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (timer !== undefined) clearTimeout(timer);
		parsed.dispose();
		changed.dispose();
		resized.dispose();
		cleared.dispose();
		reset.dispose();
		uninstall();
		close(false);
		history.clear();
	};
	terminal.loadAddon({ activate() {}, dispose });
	return dispose;
}
