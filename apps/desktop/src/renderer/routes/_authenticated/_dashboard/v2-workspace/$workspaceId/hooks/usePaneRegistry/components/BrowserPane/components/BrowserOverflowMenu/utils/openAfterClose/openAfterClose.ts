/**
 * A Dialog opened synchronously from the same click that's dismissing
 * something else (a DropdownMenuItem select, a toast action) gets caught by
 * that other element's own close cycle and immediately dismisses itself (a
 * well-known Radix issue): the closing element's exit animation (~150ms) is
 * still running, and its eventual focus-restore reads as a focus/pointer-
 * outside on the just-opened dialog. Waiting out the exit animation before
 * opening the dialog avoids the race.
 */
export const MENU_CLOSE_ANIMATION_MS = 200;

export function openAfterClose(setOpen: (open: boolean) => void) {
	return () => {
		setTimeout(() => setOpen(true), MENU_CLOSE_ANIMATION_MS);
	};
}
