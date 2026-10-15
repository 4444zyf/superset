import { Trans } from "@lingui/react/macro";
import { DropdownMenuItem } from "@superset/ui/dropdown-menu";
import { VscArrowDown, VscRefresh, VscSync } from "react-icons/vsc";

export function GitSyncMenuItems({
	onPull,
	onSync,
	onFetch,
	onFetchAndPull,
	pullCount,
	pushCount,
	disabled = false,
	canPull = true,
	canSync = true,
	canFetch = true,
}: {
	onPull(): void;
	onSync(): void;
	onFetch(): void;
	onFetchAndPull(): void;
	pullCount: number;
	pushCount: number;
	disabled?: boolean;
	canPull?: boolean;
	canSync?: boolean;
	canFetch?: boolean;
}) {
	return (
		<>
			<DropdownMenuItem
				data-git-sync-action="pull"
				onClick={onPull}
				disabled={disabled || !canPull || pullCount === 0}
				className="text-xs"
			>
				<VscArrowDown className="size-3.5" />
				<span className="flex-1">
					<Trans>Pull</Trans>
				</span>
				{pullCount > 0 && (
					<span className="text-[10px] text-muted-foreground">{pullCount}</span>
				)}
			</DropdownMenuItem>
			<DropdownMenuItem
				data-git-sync-action="sync"
				onClick={onSync}
				disabled={disabled || !canSync || (pushCount === 0 && pullCount === 0)}
				className="text-xs"
			>
				<VscSync className="size-3.5" />
				<Trans>Sync</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				data-git-sync-action="fetch"
				onClick={onFetch}
				disabled={disabled || !canFetch}
				className="text-xs"
			>
				<VscRefresh className="size-3.5" />
				<Trans>Fetch</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				data-git-sync-action="fetch-pull"
				onClick={onFetchAndPull}
				disabled={disabled || !canPull}
				className="text-xs"
			>
				<VscRefresh className="size-3.5" />
				<Trans>Fetch &amp; Pull</Trans>
			</DropdownMenuItem>
		</>
	);
}
