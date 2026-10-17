import { Trans, useLingui } from "@lingui/react/macro";
import type { HostAgentConfig } from "@superset/host-service/settings";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { useEffect, useRef, useState } from "react";
import {
	SettingsListSidebar,
	settingsListItemClass,
} from "renderer/routes/_authenticated/settings/components/SettingsListSidebar";
import { UnsavedChangesDialog } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/UnsavedChangesDialog";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import {
	AgentConfigEditor,
	type AgentConfigEditorHandle,
	type AgentConfigSnapshot,
} from "./components/AgentConfigEditor/AgentConfigEditor";

export function RemoteAgentSettings({
	api,
	connection,
	agents,
	onChanged,
	onClose,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	agents: HostAgentConfig[];
	onChanged(config: HostAgentConfig): void;
	onClose(): void;
}) {
	const { t } = useLingui();
	const scope = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
	]);
	const [catalog, setCatalog] = useState({ scope, rows: agents });
	const [selection, setSelection] = useState({
		scope,
		id: agents[0]?.id ?? null,
	});
	const [snapshot, setSnapshot] = useState<{
		owner: string;
		value: AgentConfigSnapshot;
	} | null>(null);
	const [error, setError] = useState<{ owner: string; message: string } | null>(
		null,
	);
	const [pendingState, setPendingState] = useState({ scope, value: false });
	const [reload, setReload] = useState(0);
	const [guardError, setGuardError] = useState<string | null>(null);
	const [intent, setIntent] = useState<{
		scope: string;
		id: string | null;
	} | null>(null);
	const configs = catalog.scope === scope ? catalog.rows : agents;
	const selected =
		selection.scope === scope ? selection.id : (agents[0]?.id ?? null);
	const pending = pendingState.scope === scope && pendingState.value;
	const setPending = (value: boolean) => setPendingState({ scope, value });
	const editor = useRef<AgentConfigEditorHandle>(null);
	const capable = connection.capabilities?.workstationAgentSettingsV1 === true;
	const owner = JSON.stringify([scope, selected]);
	const requestKey = JSON.stringify([owner, reload]);
	const current = useRef(requestKey);
	current.current = requestKey;

	useEffect(() => {
		if (!capable || !selected) return;
		let active = true;
		void api
			.rpc<AgentConfigSnapshot>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "settings.agentConfigs.getWithRevisionV1",
				type: "query",
				input: { id: selected },
			})
			.then((value) => {
				if (active && current.current === requestKey) {
					setSnapshot({ owner, value });
					setError(null);
				}
			})
			.catch((error) => {
				if (active && current.current === requestKey)
					setError({ owner, message: errorMessage(error) });
			});
		return () => {
			active = false;
		};
	}, [
		api,
		capable,
		selected,
		connection.connectionId,
		connection.generation,
		owner,
		requestKey,
	]);
	const finish = (id: string | null) => {
		setIntent(null);
		if (id === null) onClose();
		else setSelection({ scope, id });
	};
	const navigate = (id: string | null) => {
		if (id === selected || pending || editor.current?.isPending()) return;
		if (editor.current?.isDirty()) {
			setGuardError(null);
			setIntent({ scope, id });
		} else finish(id);
	};
	const updateLocal = (row: HostAgentConfig) =>
		setCatalog({
			scope,
			rows: configs.map((c) => (c.id === row.id ? row : c)),
		});
	return (
		<>
			<Dialog
				open
				modal
				onOpenChange={(open) => {
					if (!open) navigate(null);
				}}
			>
				<DialogContent
					data-workstation-agent-settings
					className="grid max-h-[85vh] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-5xl"
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Agents</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>Terminal agent launch configuration</Trans>
						</DialogDescription>
					</DialogHeader>
					{!capable ? (
						<p>
							<Trans>
								This backend does not support the required capability
							</Trans>
						</p>
					) : (
						<div className="grid min-w-0 md:grid-cols-[16rem_minmax(0,1fr)]">
							<fieldset
								disabled={pending}
								className="min-w-0 [&>div]:w-full [&>div]:max-h-52 md:[&>div]:max-h-none"
							>
								<SettingsListSidebar
									searchPlaceholder={t({ message: "Filter agents..." })}
									searchAriaLabel={t({ message: "Filter agents" })}
									groups={[
										{
											id: "agents",
											title: t({ message: "Agents" }),
											rows: configs,
										},
									]}
									filterRow={(row, q) =>
										row.label.toLowerCase().includes(q.toLowerCase())
									}
									getRowKey={(row) => row.id}
									emptyLabel={t({ message: "No agents yet." })}
									noMatchLabel={(q) =>
										t({ message: `No agents match "${q}".` })
									}
									renderRow={(row) => (
										<button
											type="button"
											className={settingsListItemClass(
												row.id === selected,
												"w-full text-left",
											)}
											onClick={() => navigate(row.id)}
										>
											{row.label}
										</button>
									)}
								/>
							</fieldset>
							{snapshot?.owner === owner ? (
								<AgentConfigEditor
									key={owner}
									ref={editor}
									api={api}
									connection={connection}
									snapshot={snapshot.value}
									onPendingChange={setPending}
									onChanged={(row) => {
										updateLocal(row);
										onChanged(row);
									}}
									onReloaded={updateLocal}
								/>
							) : (
								<div className="p-4">
									{error?.owner === owner ? (
										<>
											<p role="alert">{error.message}</p>
											<Button onClick={() => setReload((v) => v + 1)}>
												<Trans>Retry</Trans>
											</Button>
										</>
									) : (
										<p>
											<Trans>Loading...</Trans>
										</p>
									)}
								</div>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
			<UnsavedChangesDialog
				open={intent?.scope === scope}
				onOpenChange={(open) => {
					if (!open && !pending) setIntent(null);
				}}
				isSaving={pending}
				title={t({ message: "Unsaved changes" })}
				description={t({
					message: "Your changes will be lost if you don't save them.",
				})}
				discardLabel={t({ message: "Discard changes" })}
				saveLabel={t({ message: "Save" })}
				details={
					guardError ? (
						<p role="alert" className="break-all text-sm text-destructive">
							{guardError}
						</p>
					) : undefined
				}
				onDiscard={() => {
					if (intent && !pending) finish(intent.id);
				}}
				onSave={() => {
					const next = intent;
					if (next)
						void editor.current?.save().then((saved) => {
							if (current.current !== requestKey) return;
							if (saved) finish(next.id);
							else
								setGuardError(
									editor.current?.getError() ??
										t({ message: "Failed to save" }),
								);
						});
				}}
			/>
		</>
	);
}
