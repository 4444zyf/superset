import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DirectLocalDataApi,
	DirectLocalNamespace,
} from "../../../../../shared/direct-workstation";
import { LegacyHistoryPanel } from "./components/LegacyHistoryPanel";
import { LegacySourcesPanel } from "./components/LegacySourcesPanel";
import { useScopedAsync } from "./hooks/useScopedAsync";

const button =
	"rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40";

export function LocalDataPanel({
	api,
	onError,
	onNamespaceSelected,
}: {
	api: DirectLocalDataApi;
	onError(message: string): void;
	onNamespaceSelected(namespace: DirectLocalNamespace): void;
}) {
	const { t } = useLingui();
	const [namespaces, setNamespaces] = useState<DirectLocalNamespace[]>([]);
	const selected = namespaces.find((row) => row.selected);
	const selectionHandler = useRef(onNamespaceSelected);
	selectionHandler.current = onNamespaceSelected;
	const [label, setLabel] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const { busy, run } = useScopedAsync(selected?.id ?? "", (error) =>
		onError(error instanceof Error ? error.message : String(error)),
	);
	const applyNamespaces = useCallback((rows: DirectLocalNamespace[]) => {
		setNamespaces(rows);
		const selection = rows.find((row) => row.selected);
		if (selection) selectionHandler.current(selection);
	}, []);
	const reload = useCallback(() => {
		void run(() => api.listNamespaces(), applyNamespaces);
	}, [api, run, applyNamespaces]);
	useEffect(() => {
		reload();
	}, [reload]);
	return (
		<section className="mt-3 min-w-0 rounded border border-zinc-700 p-3 space-y-3">
			<h3 className="text-sm font-medium">
				<Trans>Local data</Trans>
			</h3>
			{selected && (
				<div className="flex gap-2 flex-wrap items-center">
					<label className="min-w-0 text-sm flex gap-2 flex-wrap items-center">
						<Trans>Local namespace</Trans>
						<select
							className="max-w-full rounded bg-zinc-900 p-2"
							value={selected.id}
							disabled={busy}
							onChange={(event) => {
								const id = event.target.value;
								void run(
									() => api.selectNamespace(id),
									(namespace) =>
										applyNamespaces(
											namespaces.map((row) => ({
												...(row.id === namespace.id ? namespace : row),
												selected: row.id === namespace.id,
											})),
										),
								);
							}}
						>
							{namespaces.map((row) => (
								<option key={row.id} value={row.id}>
									{row.isDefault
										? t({ message: "Default namespace" })
										: row.label}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						className={button}
						disabled={busy}
						onClick={reload}
					>
						<Trans>Refresh namespaces</Trans>
					</button>
				</div>
			)}
			<p className="text-xs text-zinc-400">
				<Trans>
					Switching namespaces disconnects this app. Running tasks continue;
					connect explicitly to use the selected namespace.
				</Trans>
			</p>
			<form
				className="flex gap-2 flex-wrap"
				onSubmit={(event) => {
					event.preventDefault();
					if (!label.trim()) return;
					void run(
						async () => {
							await api.createNamespace(label.trim());
							return await api.listNamespaces();
						},
						(rows) => {
							applyNamespaces(rows);
							setLabel("");
							setNotice(
								t({
									message:
										"Namespace created. Select it before starting the backend.",
								}),
							);
						},
					);
				}}
			>
				<input
					aria-label={t({ message: "New namespace name" })}
					className="min-w-0 max-w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
					maxLength={128}
					value={label}
					disabled={busy}
					onChange={(event) => setLabel(event.target.value)}
				/>
				<button
					type="submit"
					className={button}
					disabled={busy || !label.trim()}
				>
					<Trans>Create namespace</Trans>
				</button>
			</form>
			{namespaces.some((row) => !row.selected && !row.isDefault) && (
				<div className="space-y-2">
					<h4 className="text-sm">
						<Trans>Other namespaces</Trans>
					</h4>
					<p className="text-xs text-zinc-400">
						<Trans>
							Stop a namespace, switch to another, then remove it from this
							list. Its data is retained.
						</Trans>
					</p>
					{namespaces
						.filter((row) => !row.selected && !row.isDefault)
						.map((row) => (
							<fieldset
								key={row.id}
								className="rounded border border-zinc-800 p-2"
							>
								<legend className="text-sm">{row.label}</legend>
								<button
									type="button"
									className={button}
									disabled={busy}
									onClick={() => {
										void run(
											async () => ({
												result: await api.removeNamespace(row.id),
												rows: await api.listNamespaces(),
											}),
											({ result, rows }) => {
												applyNamespaces(rows);
												setNotice(
													result && result.status === "cancelled"
														? t({ message: "Cancelled" })
														: null,
												);
											},
										);
									}}
								>
									<Trans>Remove namespace</Trans>
								</button>
							</fieldset>
						))}
				</div>
			)}
			{notice && <output className="block text-sm">{notice}</output>}
			{selected && (
				<>
					<LegacySourcesPanel
						api={api}
						namespaceId={selected.namespaceId}
						onError={onError}
						onImported={reload}
					/>
					<LegacyHistoryPanel
						api={api}
						namespaceId={selected.namespaceId}
						onError={onError}
					/>
				</>
			)}
		</section>
	);
}
