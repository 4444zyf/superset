import { Trans } from "@lingui/react/macro";
import type {
	ImportedLegacyHistoryChunk,
	ImportedLegacyHistoryEntry,
	ImportedLegacyHistoryPage,
} from "@superset/shared/direct-legacy-data";
import { useCallback, useEffect, useState } from "react";
import stripAnsi from "strip-ansi";
import type { DirectLocalDataApi } from "../../../../../../../shared/direct-workstation";
import { useScopedAsync } from "../../hooks/useScopedAsync";

const button =
	"rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40";

export function LegacyHistoryPanel({
	api,
	namespaceId,
	onError,
}: {
	api: Pick<DirectLocalDataApi, "listLegacyHistory" | "readLegacyHistory">;
	namespaceId: string;
	onError(message: string): void;
}) {
	const [cursor, setCursor] = useState({ namespaceId, offset: 0 });
	const offset = cursor.namespaceId === namespaceId ? cursor.offset : 0;
	const [page, setPage] = useState<{
		namespaceId: string;
		page: ImportedLegacyHistoryPage;
	} | null>(null);
	const currentPage = page?.namespaceId === namespaceId ? page.page : null;
	const [selection, setSelection] = useState<{
		namespaceId: string;
		entry: ImportedLegacyHistoryEntry;
	} | null>(null);
	const selected =
		selection?.namespaceId === namespaceId ? selection.entry : null;
	const readScope = JSON.stringify([
		namespaceId,
		selected?.workspaceId,
		selected?.terminalId,
	]);
	const [transcript, setTranscript] = useState<{
		scope: string;
		chunk: ImportedLegacyHistoryChunk;
		previous: number[];
	} | null>(null);
	const currentTranscript = transcript?.scope === readScope ? transcript : null;
	const report = (error: unknown) =>
		onError(error instanceof Error ? error.message : String(error));
	const { busy: listing, run: runList } = useScopedAsync(
		JSON.stringify([namespaceId, offset]),
		report,
	);
	const { busy: reading, run: runRead } = useScopedAsync(readScope, report);
	const loadPage = useCallback(
		(pageOffset: number) => {
			void runList(
				() =>
					api.listLegacyHistory({ namespaceId, offset: pageOffset, limit: 50 }),
				(result) => setPage({ namespaceId, page: result }),
			);
		},
		[api, namespaceId, runList],
	);
	useEffect(() => {
		loadPage(offset);
	}, [loadPage, offset]);
	useEffect(() => {
		if (!selected) return;
		void runRead(
			() =>
				api.readLegacyHistory({
					namespaceId,
					workspaceId: selected.workspaceId,
					terminalId: selected.terminalId,
					byteOffset: 0,
					byteLimit: 8192,
				}),
			(result) =>
				setTranscript({ scope: readScope, chunk: result, previous: [] }),
		);
	}, [api, namespaceId, selected, readScope, runRead]);
	const turnPage = (pageOffset: number) => {
		setSelection(null);
		setCursor({ namespaceId, offset: pageOffset });
	};
	const readPart = (byteOffset: number, previous: number[]) => {
		if (!selected) return;
		void runRead(
			() =>
				api.readLegacyHistory({
					namespaceId,
					workspaceId: selected.workspaceId,
					terminalId: selected.terminalId,
					byteOffset,
					byteLimit: 8192,
				}),
			(result) => setTranscript({ scope: readScope, chunk: result, previous }),
		);
	};
	return (
		<section className="min-w-0 rounded border border-zinc-700 p-3 space-y-3">
			<div className="flex gap-2 flex-wrap items-center">
				<h3 className="text-sm font-medium">
					<Trans>Archived terminal history</Trans>
				</h3>
				<button
					type="button"
					className={button}
					disabled={listing}
					onClick={() => loadPage(offset)}
				>
					<Trans>Refresh</Trans>
				</button>
			</div>
			<p className="text-xs text-zinc-400">
				<Trans>
					This is an archived transcript. It does not control a running
					terminal.
				</Trans>
			</p>
			{currentPage && currentPage.entries.length === 0 && (
				<p className="text-sm text-zinc-400">
					<Trans>No archived terminal history.</Trans>
				</p>
			)}
			<div className="flex gap-2 flex-wrap">
				{currentPage?.entries.map((entry) => (
					<button
						key={`${entry.workspaceId}:${entry.terminalId}`}
						type="button"
						className={`${button} min-w-0 break-all`}
						disabled={listing}
						onClick={() => setSelection({ namespaceId, entry })}
					>
						{entry.cwd} · {entry.terminalId}
					</button>
				))}
			</div>
			<div className="flex gap-2">
				{offset > 0 && (
					<button
						type="button"
						className={button}
						disabled={listing}
						onClick={() => turnPage(Math.max(0, offset - 50))}
					>
						<Trans>Previous page</Trans>
					</button>
				)}
				{currentPage?.nextOffset !== undefined && (
					<button
						type="button"
						className={button}
						disabled={listing}
						onClick={() => turnPage(currentPage.nextOffset ?? 0)}
					>
						<Trans>Next page</Trans>
					</button>
				)}
			</div>
			{selected && (
				<div className="space-y-2">
					<code className="block text-xs break-all">
						{selected.cwd} · {selected.workspaceId} · {selected.terminalId}
					</code>
					{selected.agentSessionId && (
						<p className="text-xs">
							<Trans>Agent context</Trans>:{" "}
							<code>
								{selected.agentId} · {selected.agentSessionId}
							</code>
						</p>
					)}
					{currentTranscript && (
						<>
							<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-zinc-900 p-3 text-xs">
								{stripAnsi(currentTranscript.chunk.text)}
							</pre>
							<div className="flex gap-2">
								{currentTranscript.previous.length > 0 && (
									<button
										type="button"
										className={button}
										disabled={reading}
										onClick={() =>
											readPart(
												currentTranscript.previous.at(-1) ?? 0,
												currentTranscript.previous.slice(0, -1),
											)
										}
									>
										<Trans>Previous part</Trans>
									</button>
								)}
								{currentTranscript.chunk.nextByteOffset !== undefined && (
									<button
										type="button"
										className={button}
										disabled={reading}
										onClick={() =>
											readPart(
												currentTranscript.chunk.nextByteOffset ?? 0,
												[
													...currentTranscript.previous,
													currentTranscript.chunk.byteOffset,
												].slice(-1024),
											)
										}
									>
										<Trans>Next part</Trans>
									</button>
								)}
							</div>
						</>
					)}
					<button
						type="button"
						className={button}
						onClick={() => setSelection(null)}
					>
						<Trans>Close</Trans>
					</button>
				</div>
			)}
		</section>
	);
}
