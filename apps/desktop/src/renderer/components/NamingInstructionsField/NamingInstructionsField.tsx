import { Trans, useLingui } from "@lingui/react/macro";
import { Label } from "@superset/ui/label";
import { Textarea } from "@superset/ui/textarea";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiCheckCircle } from "react-icons/hi2";

interface NamingInstructionsFieldProps {
	instructions: string | null;
	onSave(value: string): Promise<unknown>;
	onChanged?(): void;
	disabled?: boolean;
	pauseOnError?: boolean;
	debounceMs?: number;
	maxLength?: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 500;
const SAVED_INDICATOR_MS = 2000;

export function NamingInstructionsField({
	instructions,
	onSave,
	onChanged,
	disabled,
	pauseOnError = false,
	debounceMs = SAVE_DEBOUNCE_MS,
	maxLength,
}: NamingInstructionsFieldProps) {
	const { t } = useLingui();
	const savedValue = instructions ?? "";
	const [value, setValue] = useState(savedValue);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

	// Ask the DOM instead of tracking focus in a ref: a focus-tracking ref
	// wedges stuck-true if the field unmounts while focused (same rationale
	// as SparseCheckoutSection).
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const latestValueRef = useRef(value);
	const lastSavedRef = useRef(savedValue);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveInFlightRef = useRef(false);
	const queuedValueRef = useRef<string | null>(null);
	const isMountedRef = useRef(true);
	const pausedRef = useRef(false);

	useEffect(() => {
		// Don't clobber an in-progress edit when the host row refetches.
		const isFocused =
			!!textareaRef.current && document.activeElement === textareaRef.current;
		if (isFocused || debounceTimerRef.current || saveInFlightRef.current) {
			return;
		}
		setValue(savedValue);
		latestValueRef.current = savedValue;
		lastSavedRef.current = savedValue;
	}, [savedValue]);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		};
	}, []);

	const flushSaveRef = useRef<((next: string) => Promise<void>) | null>(null);
	const flushSave = useCallback(
		async (next: string) => {
			if (pausedRef.current || !isMountedRef.current) return;
			// Remember the latest intent while a request is in flight; the
			// `finally` below drains it once this attempt settles.
			if (saveInFlightRef.current) {
				queuedValueRef.current = next;
				return;
			}
			if (next.trim() === lastSavedRef.current.trim()) {
				queuedValueRef.current = null;
				return;
			}

			if (savedTimerRef.current) {
				clearTimeout(savedTimerRef.current);
				savedTimerRef.current = null;
			}
			setSaveStatus("saving");
			saveInFlightRef.current = true;
			try {
				await onSave(next);
				lastSavedRef.current = next;
				if (!isMountedRef.current) return;
				setSaveStatus("saved");
				savedTimerRef.current = setTimeout(() => {
					setSaveStatus("idle");
					savedTimerRef.current = null;
				}, SAVED_INDICATOR_MS);
				onChanged?.();
			} catch (err) {
				if (pauseOnError) {
					pausedRef.current = true;
					if (debounceTimerRef.current) {
						clearTimeout(debounceTimerRef.current);
						debounceTimerRef.current = null;
					}
					queuedValueRef.current = null;
				}

				console.warn("[naming-instructions/save] failed", err);
				if (isMountedRef.current) setSaveStatus("error");
			} finally {
				saveInFlightRef.current = false;
				const pending = queuedValueRef.current;
				queuedValueRef.current = null;
				if (pending !== null && isMountedRef.current && !pausedRef.current) {
					void flushSaveRef.current?.(pending);
				}
			}
		},
		[onChanged, onSave, pauseOnError],
	);
	flushSaveRef.current = flushSave;

	const handleChange = useCallback(
		(nextValue: string) => {
			setValue(nextValue);
			latestValueRef.current = nextValue;
			if (pausedRef.current) return;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = setTimeout(() => {
				debounceTimerRef.current = null;
				void flushSave(latestValueRef.current);
			}, debounceMs);
		},
		[flushSave, debounceMs],
	);

	const handleBlur = useCallback(() => {
		// Commit immediately on the way out instead of leaving the last
		// keystrokes sitting in the debounce window.
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		void flushSave(latestValueRef.current);
	}, [flushSave]);

	return (
		<div className="pt-4" data-project-text-field="naming">
			<div className="mb-3">
				<Label
					htmlFor="project-naming-instructions"
					className="text-sm font-medium"
				>
					<Trans>Naming instructions</Trans>
				</Label>
				<p className="mt-0.5 text-xs text-muted-foreground">
					<Trans>
						Guides AI-generated workspace and branch names for this project.
						Empty uses the default naming.
					</Trans>
				</p>
			</div>
			<Textarea
				disabled={disabled}
				maxLength={maxLength}
				ref={textareaRef}
				id="project-naming-instructions"
				value={value}
				onChange={(e) => handleChange(e.target.value)}
				onBlur={handleBlur}
				placeholder={t({
					message:
						"Include the Linear ticket id from the prompt in the branch name (e.g. bin-344-fix-login). Prefix branches with fix/ or feat/ based on the task.",
				})}
				rows={3}
				spellCheck={false}
				className="text-sm resize-y min-h-[calc(3lh+1.125rem)]"
			/>
			<div
				role="status"
				aria-live="polite"
				className="flex h-4 items-center justify-end text-xs text-muted-foreground"
			>
				{saveStatus === "saving" && (
					<span>
						<Trans>Saving…</Trans>
					</span>
				)}
				{saveStatus === "saved" && (
					<span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
						<HiCheckCircle className="h-3.5 w-3.5" />
						<Trans>Saved</Trans>
					</span>
				)}
				{saveStatus === "error" && (
					<span className="select-text cursor-text text-destructive">
						{pauseOnError ? (
							<Trans>Couldn't save</Trans>
						) : (
							<Trans>Couldn't save — edit or click away to retry</Trans>
						)}
					</span>
				)}
			</div>
		</div>
	);
}
