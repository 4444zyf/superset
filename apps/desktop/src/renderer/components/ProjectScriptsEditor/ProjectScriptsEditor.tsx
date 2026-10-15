import { Trans, useLingui } from "@lingui/react/macro";
import { Skeleton } from "@superset/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiCheckCircle } from "react-icons/hi2";
import { ScriptField } from "./components/ScriptField";

interface ProjectScriptsEditorProps {
	content: string | null;
	isLoading?: boolean;
	disabled?: boolean;
	className?: string;
	debounceMs?: number;
	pauseOnError?: boolean;
	maxLength?: number;
	onSave(scripts: {
		setup: string[];
		teardown: string[];
		run: string[];
	}): Promise<unknown>;
}

interface ParsedConfig {
	setup: string;
	teardown: string;
	run: string;
}

type ScriptFieldName = keyof ParsedConfig;

interface ScriptPayload {
	setup: string[];
	teardown: string[];
	run: string[];
}

function parseConfigContent(content: string | null): ParsedConfig {
	if (!content) return { setup: "", teardown: "", run: "" };
	try {
		const parsed = JSON.parse(content);
		const setup = Array.isArray(parsed?.setup)
			? parsed.setup.filter((s: unknown): s is string => typeof s === "string")
			: [];
		const teardown = Array.isArray(parsed?.teardown)
			? parsed.teardown.filter(
					(s: unknown): s is string => typeof s === "string",
				)
			: [];
		const run = Array.isArray(parsed?.run)
			? parsed.run.filter((s: unknown): s is string => typeof s === "string")
			: [];
		return {
			setup: setup.join("\n"),
			teardown: teardown.join("\n"),
			run: run.join("\n"),
		};
	} catch {
		return { setup: "", teardown: "", run: "" };
	}
}

function toCommandsArray(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function arraysEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

function buildPayload(values: ParsedConfig): ScriptPayload {
	return {
		setup: toCommandsArray(values.setup),
		teardown: toCommandsArray(values.teardown),
		run: toCommandsArray(values.run),
	};
}

function payloadsEqual(a: ScriptPayload, b: ScriptPayload): boolean {
	return (
		arraysEqual(a.setup, b.setup) &&
		arraysEqual(a.teardown, b.teardown) &&
		arraysEqual(a.run, b.run)
	);
}

function trimScriptValue(value: string): string {
	return value
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.replace(/^\n+|\n+$/g, "");
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ProjectScriptsEditor({
	content,
	isLoading,
	disabled,
	className,
	debounceMs = 500,
	pauseOnError = false,
	maxLength,
	onSave,
}: ProjectScriptsEditorProps) {
	const { t } = useLingui();
	const [setupValue, setSetupValue] = useState("");
	const [teardownValue, setTeardownValue] = useState("");
	const [runValue, setRunValue] = useState("");
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const focusedRef = useRef<ScriptFieldName | null>(null);
	const latestValuesRef = useRef<ParsedConfig>({
		setup: "",
		teardown: "",
		run: "",
	});
	const lastSavedRef = useRef<ScriptPayload>({
		setup: [],
		teardown: [],
		run: [],
	});
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveInFlightRef = useRef(false);
	const queuedPayloadRef = useRef<ScriptPayload | null>(null);
	const mountedRef = useRef(true);
	const pausedRef = useRef(false);

	useEffect(() => {
		// Don't clobber an in-progress edit when the server-side query refetches.
		if (
			focusedRef.current ||
			debounceTimerRef.current ||
			saveInFlightRef.current ||
			queuedPayloadRef.current
		) {
			return;
		}
		const parsed = parseConfigContent(content);
		setSetupValue(parsed.setup);
		setTeardownValue(parsed.teardown);
		setRunValue(parsed.run);
		latestValuesRef.current = parsed;
		lastSavedRef.current = buildPayload(parsed);
	}, [content]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			queuedPayloadRef.current = null;
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
			if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
		};
	}, []);

	const flushSave = useCallback(
		async (next: ScriptPayload = buildPayload(latestValuesRef.current)) => {
			if (pausedRef.current || !mountedRef.current) return;
			if (saveInFlightRef.current) {
				queuedPayloadRef.current = next;
				return;
			}
			if (payloadsEqual(next, lastSavedRef.current)) return;

			if (savedTimerRef.current) {
				clearTimeout(savedTimerRef.current);
				savedTimerRef.current = null;
			}

			setSaveStatus("saving");
			saveInFlightRef.current = true;
			try {
				let payloadToSave: ScriptPayload | null = next;

				while (payloadToSave && mountedRef.current && !pausedRef.current) {
					queuedPayloadRef.current = null;

					if (!payloadsEqual(payloadToSave, lastSavedRef.current)) {
						await onSave(payloadToSave);
						if (!mountedRef.current) return;
						lastSavedRef.current = payloadToSave;
					}

					payloadToSave = queuedPayloadRef.current;
				}

				if (!mountedRef.current) return;
				setSaveStatus("saved");
				savedTimerRef.current = setTimeout(() => {
					setSaveStatus("idle");
					savedTimerRef.current = null;
				}, 2000);
			} catch (error) {
				if (!mountedRef.current) return;
				if (pauseOnError) {
					pausedRef.current = true;
					queuedPayloadRef.current = null;
					if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
					debounceTimerRef.current = null;
					setSaveStatus("error");
					return;
				}
				console.error("[v2-scripts/save] failed", error);
				queuedPayloadRef.current =
					queuedPayloadRef.current ?? buildPayload(latestValuesRef.current);
				setSaveStatus("idle");
				if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = setTimeout(() => {
					debounceTimerRef.current = null;
					const payloadToRetry = queuedPayloadRef.current;
					queuedPayloadRef.current = null;
					if (payloadToRetry) void flushSave(payloadToRetry);
				}, 1000);
			} finally {
				saveInFlightRef.current = false;
			}
		},
		[onSave, pauseOnError],
	);

	const scheduleSave = useCallback(
		(nextValues: ParsedConfig) => {
			latestValuesRef.current = nextValues;
			if (pausedRef.current || disabled) return;

			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

			debounceTimerRef.current = setTimeout(() => {
				debounceTimerRef.current = null;
				void flushSave(buildPayload(latestValuesRef.current));
			}, debounceMs);
		},
		[flushSave, debounceMs, disabled],
	);

	const handleChange = useCallback(
		(field: ScriptFieldName, value: string) => {
			const nextValues = { ...latestValuesRef.current, [field]: value };
			latestValuesRef.current = nextValues;

			if (field === "setup") setSetupValue(value);
			if (field === "teardown") setTeardownValue(value);
			if (field === "run") setRunValue(value);

			scheduleSave(nextValues);
		},
		[scheduleSave],
	);

	const handleBlur = useCallback(async () => {
		focusedRef.current = null;

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}

		const trimmedValues = {
			setup: trimScriptValue(latestValuesRef.current.setup),
			teardown: trimScriptValue(latestValuesRef.current.teardown),
			run: trimScriptValue(latestValuesRef.current.run),
		};
		latestValuesRef.current = trimmedValues;

		if (trimmedValues.setup !== setupValue) setSetupValue(trimmedValues.setup);
		if (trimmedValues.teardown !== teardownValue) {
			setTeardownValue(trimmedValues.teardown);
		}
		if (trimmedValues.run !== runValue) setRunValue(trimmedValues.run);

		await flushSave(buildPayload(trimmedValues));
	}, [flushSave, runValue, setupValue, teardownValue]);

	if (isLoading) {
		return (
			<div className={cn("space-y-3", className)} aria-busy="true">
				<div className="flex h-9 items-center gap-5 border-b border-border px-2">
					<Skeleton className="h-3 w-10" />
					<Skeleton className="h-3 w-14" />
					<Skeleton className="h-3 w-8" />
				</div>
				<Skeleton className="h-24 w-full rounded-md" />
			</div>
		);
	}

	return (
		<div className={cn("space-y-3", className)} data-project-scripts>
			<Tabs defaultValue="setup">
				<div className="flex items-center justify-between gap-2 border-b border-border">
					<TabsList className="h-auto gap-0 rounded-none bg-transparent p-0">
						<TabsTrigger
							value="setup"
							className="relative h-8 rounded-none border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent data-[state=active]:after:bg-foreground"
						>
							<Trans>Setup</Trans>
						</TabsTrigger>
						<TabsTrigger
							value="teardown"
							className="relative h-8 rounded-none border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent data-[state=active]:after:bg-foreground"
						>
							<Trans>Teardown</Trans>
						</TabsTrigger>
						<TabsTrigger
							value="run"
							className="relative h-8 rounded-none border-0 bg-transparent px-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent data-[state=active]:after:bg-foreground"
						>
							<Trans>Run</Trans>
						</TabsTrigger>
					</TabsList>
					<div
						role="status"
						aria-live="polite"
						className="flex h-5 items-center pb-1.5 text-xs text-muted-foreground"
					>
						{saveStatus === "error" && (
							<span className="text-destructive">
								<Trans>Couldn't save</Trans>
							</span>
						)}
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
					</div>
				</div>
				<TabsContent value="setup">
					<ScriptField
						label={t({ message: "Setup" })}
						disabled={disabled}
						maxLength={maxLength}
						placeholder="bun install&#10;bun run db:migrate"
						value={setupValue}
						onChange={(value) => handleChange("setup", value)}
						onFocus={() => {
							focusedRef.current = "setup";
						}}
						onBlur={() => handleBlur()}
					/>
				</TabsContent>
				<TabsContent value="teardown">
					<ScriptField
						label={t({ message: "Teardown" })}
						disabled={disabled}
						maxLength={maxLength}
						placeholder="docker compose down"
						value={teardownValue}
						onChange={(value) => handleChange("teardown", value)}
						onFocus={() => {
							focusedRef.current = "teardown";
						}}
						onBlur={() => handleBlur()}
					/>
				</TabsContent>
				<TabsContent value="run">
					<ScriptField
						label={t({ message: "Run" })}
						disabled={disabled}
						maxLength={maxLength}
						placeholder="bun dev"
						value={runValue}
						onChange={(value) => handleChange("run", value)}
						onFocus={() => {
							focusedRef.current = "run";
						}}
						onBlur={() => handleBlur()}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
