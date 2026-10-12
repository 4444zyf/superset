import { Trans, useLingui } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import type {
	LegacyDiscovery,
	LegacyImportPreview,
} from "@superset/shared/direct-legacy-data";
import { useState } from "react";
import type {
	DirectLocalDataApi,
	DirectLocalImportResult,
} from "../../../../../../../shared/direct-workstation";
import { useScopedAsync } from "../../hooks/useScopedAsync";

const button =
	"rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40";

export function LegacySourcesPanel({
	api,
	namespaceId,
	onError,
	onImported,
}: {
	api: Pick<
		DirectLocalDataApi,
		"discoverLegacySources" | "previewLegacySources" | "importSource"
	>;
	namespaceId: string;
	onError(message: string): void;
	onImported(result: DirectLocalImportResult): void;
}) {
	const { t } = useLingui();
	const [discovery, setDiscovery] = useState<LegacyDiscovery | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [labels, setLabels] = useState<Record<string, string>>({});
	const scope = JSON.stringify([namespaceId, selected]);
	const [preview, setPreview] = useState<{
		scope: string;
		result: LegacyImportPreview;
	} | null>(null);
	const currentPreview = preview?.scope === scope ? preview.result : null;
	const [notice, setNotice] = useState<string | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [action, setAction] = useState<
		"discover" | "preview" | "import" | null
	>(null);
	const { busy, run } = useScopedAsync(scope, (error) =>
		onError(error instanceof Error ? error.message : String(error)),
	);
	return (
		<section className="min-w-0 rounded border border-zinc-700 p-3 space-y-3">
			<h3 className="text-sm font-medium">
				<Trans>Legacy data sources</Trans>
			</h3>
			<p className="text-xs text-zinc-400">
				<Trans>
					Each source is imported into a separate namespace. Existing
					repositories stay at their current paths.
				</Trans>
			</p>
			<p className="text-xs text-zinc-400">
				<Trans>Finish active tasks in the old app before importing.</Trans>
			</p>
			<div className="flex gap-2 flex-wrap">
				<button
					type="button"
					className={button}
					disabled={busy}
					onClick={() => {
						setAction("discover");
						void run(
							() => api.discoverLegacySources(),
							(result) => {
								setDiscovery(result);
								setSelected([]);
								setLabels({});
								setPreview(null);
								setNotice(null);
								setWarnings([]);
							},
						);
					}}
				>
					<Trans>Discover local data</Trans>
				</button>
				<button
					type="button"
					className={button}
					disabled={busy || !selected.length}
					onClick={() => {
						setAction("preview");
						void run(
							() => api.previewLegacySources(selected),
							(result) => setPreview({ scope, result }),
						);
					}}
				>
					<Trans>Preview selected sources</Trans>
				</button>
			</div>
			{discovery?.sources.length === 0 && (
				<p className="text-sm text-zinc-400">
					<Trans>No local legacy data found.</Trans>
				</p>
			)}
			{discovery?.sources.map((source) => {
				const inspected = currentPreview?.sources.find(
					(item) => item.source.id === source.id,
				);
				return (
					<fieldset
						key={source.id}
						className="min-w-0 rounded border border-zinc-800 p-3 space-y-2"
					>
						<legend className="text-sm">{source.sourceNamespace}</legend>
						<label className="flex gap-2 text-sm items-start">
							<input
								type="checkbox"
								checked={selected.includes(source.id)}
								disabled={busy && action === "import"}
								onChange={(event) =>
									setSelected((previous) =>
										event.target.checked
											? [...previous, source.id].slice(0, 32)
											: previous.filter((id) => id !== source.id),
									)
								}
							/>
							{source.sourceNamespace} · {source.format}
						</label>
						<code className="block text-xs break-all">
							{source.sourceDirectory}
						</code>
						{inspected?.counts && (
							<p className="text-xs">
								<Trans>Projects</Trans>:{" "}
								{formatNumber(inspected.counts.projects)} ·{" "}
								<Trans>Workspaces</Trans>:{" "}
								{formatNumber(inspected.counts.workspaces)} ·{" "}
								<Trans>Terminals</Trans>:{" "}
								{formatNumber(inspected.counts.terminals)} ·{" "}
								<Trans>Chats</Trans>: {formatNumber(inspected.counts.chats)}
							</p>
						)}
						{inspected?.status === "blocked" && (
							<p className="text-sm text-amber-300">
								<Trans>This source cannot be imported.</Trans>{" "}
								{inspected.reason}
							</p>
						)}
						<div className="flex gap-2 flex-wrap items-center">
							<label className="min-w-0 text-sm flex gap-2 flex-wrap items-center">
								<Trans>Namespace name</Trans>
								<input
									className="min-w-0 max-w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
									maxLength={128}
									disabled={busy && action === "import"}
									value={
										labels[source.id] ?? source.sourceNamespace.slice(0, 128)
									}
									onChange={(event) =>
										setLabels((previous) => ({
											...previous,
											[source.id]: event.target.value,
										}))
									}
								/>
							</label>
							<button
								type="button"
								className={button}
								disabled={
									busy ||
									!selected.includes(source.id) ||
									inspected?.status !== "ready"
								}
								onClick={() => {
									setAction("import");
									const label = (
										labels[source.id] ?? source.sourceNamespace.slice(0, 128)
									).trim();
									void run(
										() =>
											api.importSource({
												sourceId: source.id,
												...(label ? { label } : {}),
											}),
										(result) => {
											if ("status" in result) {
												setNotice(t({ message: "Cancelled" }));
												return;
											}
											setNotice(
												t({
													message:
														"Imported into a new namespace. Select it and start the backend when ready.",
												}),
											);
											setWarnings(result.warnings);
											onImported(result);
										},
									);
								}}
							>
								<Trans>Import source</Trans>
							</button>
						</div>
					</fieldset>
				);
			})}
			{currentPreview && currentPreview.conflictCount > 0 && (
				<div className="space-y-1 text-sm text-amber-300">
					<h4>
						<Trans>Conflicting data</Trans>
					</h4>
					{currentPreview.conflicts.map((conflict) => (
						<code
							key={`${conflict.kind}:${conflict.value}`}
							className="block break-all"
						>
							{conflict.value}
						</code>
					))}
					{currentPreview.conflictsTruncated && (
						<p>
							<Trans>Additional conflicts are not shown.</Trans>
						</p>
					)}
				</div>
			)}
			{discovery && discovery.issues.length > 0 && (
				<div className="space-y-1 text-xs text-zinc-400">
					<p>
						<Trans>Some paths could not be inspected.</Trans>
					</p>
					{discovery.issues.map((issue) => (
						<code
							className="block break-all"
							key={`${issue.path}:${issue.reason}`}
						>
							{issue.path}
						</code>
					))}
				</div>
			)}
			{notice && <output className="block text-sm">{notice}</output>}
			{warnings.map((warning, index) => (
				<p
					className="text-sm whitespace-pre-wrap text-amber-300"
					key={`${index}:${warning}`}
				>
					{warning}
				</p>
			))}
		</section>
	);
}
