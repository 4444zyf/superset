import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import {
	useDesignModeStateCore,
	type DesignModeStoreCore,
} from "../../designModeStoreCore";
export function useDesignModePane({
	paneId,
	store,
	isLoading,
	rootRef,
	placeholderRef,
	overlayContainer,
}: {
	paneId: string;
	store: DesignModeStoreCore;
	isLoading: boolean;
	rootRef: RefObject<HTMLElement | null>;
	placeholderRef: RefObject<HTMLElement | null>;
	overlayContainer: HTMLElement | null;
}) {
	const designMode = useDesignModeStateCore(paneId, store);
	useEffect(
		() => () => {
			if (store.getState(paneId).phase !== "idle") store.exit(paneId);
		},
		[paneId, store],
	);
	// Esc while the host (not the guest) owns focus: with a captured element it
	// discards the capture and goes back to picking; while picking it exits.
	// The injected overlay handles Esc itself when the guest has focus, and the
	// composer's own Esc handler covers its textarea. Scoped to keystrokes that
	// belong to this pane (or to nothing — body): Esc aimed at a portal
	// (dropdown, dialog, the composer's agent picker) must close that instead.
	// The pane's overlay layer counts as the pane: the composer lives there.
	useEffect(() => {
		if (designMode.phase === "idle") return;
		const phase = designMode.phase;
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable ||
					target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA")
			) {
				return;
			}
			const root = rootRef.current;
			const inScope =
				target === document.body ||
				(root != null && target != null && root.contains(target)) ||
				(overlayContainer != null &&
					target != null &&
					overlayContainer.contains(target));
			if (!inScope) return;
			e.preventDefault();
			e.stopPropagation();
			if (phase === "confirming") {
				store.rearm(paneId);
			} else {
				store.exit(paneId);
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [designMode.phase, paneId, overlayContainer, store]);

	// A full navigation replaces the document a capture described — drop the
	// composer instead of staging a payload (selector, bounds, verify hints)
	// for a page that no longer exists.
	useEffect(() => {
		if (designMode.phase === "confirming" && isLoading) {
			store.exit(paneId);
		}
	}, [designMode.phase, isLoading, paneId, store]);

	// Anchor the composer under the clicked element. The composer renders in
	// the pane's overlay layer, which mirrors the placeholder's box, so the
	// capture's viewport rect (guest CSS pixels) is already in its coordinate
	// space. Computed in a layout effect (refs are unset during the first
	// render of a remount) and re-clamped when the page area resizes so the
	// card stays inside it.
	const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({
		top: 12,
		left: 12,
	});
	const confirmingRect =
		designMode.phase === "confirming"
			? designMode.payload?.target.rectViewport
			: undefined;
	useLayoutEffect(() => {
		if (!confirmingRect) return;
		const placeholder = placeholderRef.current;
		if (!placeholder) return;
		const compute = () => {
			const areaWidth = placeholder.clientWidth;
			const areaHeight = placeholder.clientHeight;
			const width = Math.min(420, areaWidth - 16);
			const estimatedHeight = 170;
			const left = Math.min(
				Math.max(confirmingRect.x, 8),
				Math.max(8, areaWidth - width - 8),
			);
			const below = confirmingRect.y + confirmingRect.height + 4;
			const top =
				below + estimatedHeight > areaHeight
					? Math.max(8, confirmingRect.y - estimatedHeight - 4)
					: below;
			setPopoverStyle({ top, left, width });
		};
		compute();
		const observer = new ResizeObserver(compute);
		observer.observe(placeholder);
		return () => observer.disconnect();
	}, [confirmingRect, placeholderRef]);

	return { designMode, popoverStyle };
}
