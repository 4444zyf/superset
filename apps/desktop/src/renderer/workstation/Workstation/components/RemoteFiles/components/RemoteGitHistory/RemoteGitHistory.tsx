import { Trans, useLingui } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { Button } from "@superset/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommitRow } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/useChangesTab/components/CommitFilterDropdown/components/CommitRow/CommitRow";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

type Page = inferRouterOutputs<AppRouter>["git"]["listRepositoryCommitsV1"];
export type RemoteHistoryCommit = Page["commits"][number];
const EMPTY: Page = { head: null, commits: [], nextCursor: null };

export function RemoteGitHistory({
	api,
	connection,
	workspaceId,
	onSelect,
	onError,
	disabled = false,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	onSelect(commit: RemoteHistoryCommit): void;
	onError(message: string): void;
	disabled?: boolean;
}) {
	const { t } = useLingui();
	const [page, setPage] = useState<Page>(EMPTY);
	const [skip, setSkip] = useState(0);
	const [busy, setBusy] = useState(false);
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const ownerRef = useRef(owner);
	ownerRef.current = owner;
	const latest = useRef({ api, connection, workspaceId, onError });
	latest.current = { api, connection, workspaceId, onError };
	const epoch = useRef(0);
	const running = useRef(false);
	const load = useCallback(
		async (
			cursor?: NonNullable<Page["nextCursor"]>,
			requestOwner = ownerRef.current,
		) => {
			if (running.current || ownerRef.current !== requestOwner) return;
			const request = latest.current;
			if (!request.connection.capabilities?.workstationGitHistoryV1) return;
			running.current = true;
			const version = ++epoch.current;
			setBusy(true);
			try {
				const result = await request.api.rpc<Page>({
					connectionId: request.connection.connectionId,
					generation: request.connection.generation,
					path: "git.listRepositoryCommitsV1",
					type: "query",
					input: {
						workspaceId: request.workspaceId,
						limit: 50,
						...(cursor ? { cursor } : {}),
					},
				});
				if (version === epoch.current && ownerRef.current === requestOwner) {
					setPage(result);
					setSkip(cursor?.skip ?? 0);
				}
			} catch (error) {
				if (version === epoch.current && ownerRef.current === requestOwner)
					latest.current.onError(
						error instanceof Error ? error.message : String(error),
					);
			} finally {
				if (version === epoch.current && ownerRef.current === requestOwner) {
					running.current = false;
					setBusy(false);
				}
			}
		},
		[],
	);
	useEffect(() => {
		epoch.current++;
		running.current = false;
		setPage(EMPTY);
		setSkip(0);
		setBusy(false);
		void load(undefined, owner);
		return () => {
			epoch.current++;
			running.current = false;
		};
	}, [owner, load]);
	return (
		<section className="space-y-2" data-git-history={workspaceId}>
			<div className="flex gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy || disabled}
					onClick={() => {
						void load();
					}}
				>
					<Trans>Refresh</Trans>
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy || disabled || skip === 0 || !page.head}
					aria-label={t({ message: "Previous page" })}
					onClick={() => {
						if (page.head)
							void load({ head: page.head, skip: Math.max(0, skip - 50) });
					}}
				>
					<Trans>Previous</Trans>
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy || disabled || !page.nextCursor}
					aria-label={t({ message: "Next page" })}
					onClick={() => {
						if (page.nextCursor) void load(page.nextCursor);
					}}
				>
					<Trans>Next</Trans>
				</Button>
			</div>
			{busy && (
				<p>
					<Trans>Loading</Trans>
				</p>
			)}
			{!connection.capabilities?.workstationGitHistoryV1 ? (
				<p>
					<Trans>Unavailable</Trans>
				</p>
			) : !busy && page.commits.length === 0 ? (
				<p>
					<Trans>No commits on this branch yet.</Trans>
				</p>
			) : (
				page.commits.map((commit) => (
					<button
						type="button"
						key={commit.hash}
						data-history-commit={commit.hash}
						disabled={
							busy || disabled || !connection.capabilities?.workstationGitV1
						}
						className="flex w-full text-left p-2 rounded-md border border-border hover:bg-accent disabled:opacity-50"
						onClick={() => onSelect(commit)}
					>
						<CommitRow commit={commit} wrap />
					</button>
				))
			)}
		</section>
	);
}
