import { Trans } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { Button } from "@superset/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { BaseBranchSelector } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/useChangesTab/components/BaseBranchSelector/BaseBranchSelector";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

type Outputs = inferRouterOutputs<AppRouter>;
type Branches = Outputs["git"]["listBranches"]["branches"];
type Sync = Pick<
	Outputs["git"]["getBranchSyncStatus"],
	"defaultBranch" | "isDetached" | "currentBranch"
>;

export function RemoteBaseBranch({
	api,
	connection,
	workspaceId,
	onChange,
	onError,
	disabled = false,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	onChange(base: string | undefined): void;
	onError(message: string): void;
	disabled?: boolean;
}) {
	const [branches, setBranches] = useState<Branches>([]);
	const [base, setBase] = useState<string | null>(null);
	const [sync, setSync] = useState<Sync | null>(null);
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
	const callbacks = useRef({ onChange, onError });
	callbacks.current = { onChange, onError };
	const epoch = useRef(0);
	const running = useRef(false);
	const rpc = <T,>(path: string, type: "query" | "mutation", input: unknown) =>
		api.rpc<T>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path,
			type,
			input,
		});
	useEffect(() => {
		const version = ++epoch.current;
		const expectedOwner = owner;
		running.current = false;
		setBusy(true);
		setBase(null);
		setSync(null);
		setBranches([]);
		if (!connection.capabilities?.workstationGitV1) {
			setBusy(false);
			return;
		}
		const request = <T,>(path: string) =>
			api.rpc<T>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type: "query",
				input: { workspaceId },
			});
		void Promise.all([
			request<{ branches: Branches }>("git.listBranches"),
			request<{ baseBranch: string | null }>("git.getBaseBranch"),
			request<Sync>("git.getBranchSyncStatus"),
		])
			.then(([list, configured, status]) => {
				if (version !== epoch.current || ownerRef.current !== expectedOwner)
					return;
				setBranches(list.branches);
				setBase(configured.baseBranch);
				setSync(status);
				callbacks.current.onChange(configured.baseBranch ?? undefined);
			})
			.catch((error) => {
				if (version === epoch.current && ownerRef.current === expectedOwner)
					callbacks.current.onError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (version === epoch.current && ownerRef.current === expectedOwner)
					setBusy(false);
			});
		return () => {
			epoch.current++;
			running.current = false;
		};
	}, [
		api,
		connection.connectionId,
		connection.generation,
		connection.capabilities?.workstationGitV1,
		workspaceId,
		owner,
	]);
	const change = async (value: string | null) => {
		if (
			running.current ||
			busy ||
			disabled ||
			sync?.isDetached ||
			!connection.capabilities?.workstationGitV1
		)
			return;
		running.current = true;
		const version = epoch.current;
		const expectedOwner = owner;
		setBusy(true);
		try {
			const result = await rpc<{ baseBranch: string | null }>(
				"git.setBaseBranch",
				"mutation",
				{ workspaceId, baseBranch: value },
			);
			if (version !== epoch.current || ownerRef.current !== expectedOwner)
				return;
			setBase(result.baseBranch);
			callbacks.current.onChange(result.baseBranch ?? undefined);
		} catch (error) {
			if (version === epoch.current && ownerRef.current === expectedOwner) {
				callbacks.current.onError(
					error instanceof Error ? error.message : String(error),
				);
				try {
					const actual = await rpc<{ baseBranch: string | null }>(
						"git.getBaseBranch",
						"query",
						{ workspaceId },
					);
					if (version === epoch.current && ownerRef.current === expectedOwner) {
						setBase(actual.baseBranch);
						callbacks.current.onChange(actual.baseBranch ?? undefined);
					}
				} catch {}
			}
		} finally {
			if (version === epoch.current && ownerRef.current === expectedOwner) {
				running.current = false;
				setBusy(false);
			}
		}
	};
	return (
		<div
			className="flex items-center gap-2 text-xs"
			data-base-branch={workspaceId}
		>
			<span>
				<Trans>Base branch</Trans>
			</span>
			<BaseBranchSelector
				branches={branches}
				currentValue={
					base ??
					sync?.defaultBranch ??
					sync?.currentBranch ??
					branches.find((branch) => branch.isHead)?.name ??
					""
				}
				disabled={busy || disabled || !sync || sync.isDetached}
				onChange={(value) => {
					void change(value);
				}}
			/>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={busy || disabled || !base || sync?.isDetached}
				onClick={() => {
					void change(null);
				}}
			>
				<Trans>Auto</Trans>
			</Button>
		</div>
	);
}
