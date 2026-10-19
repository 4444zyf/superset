import { Trans, useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import type { DirectProfile, RemoteDirectory } from "../../types";
import { RemoteDirectoryBrowser } from "../RemoteDirectoryBrowser/RemoteDirectoryBrowser";
import { RemoteProjectCreator } from "../RemoteProjectCreator/RemoteProjectCreator";
import { WorkstationDialog } from "../WorkstationDialog/WorkstationDialog";

export function ProjectDialog({
	profiles,
	selectedId,
	directory,
	connected,
	busy,
	onTarget,
	onBrowse,
	onImport,
	onCreate,
	onClose,
	serverError,
}: {
	profiles: DirectProfile[];
	selectedId: string;
	directory: RemoteDirectory | null;
	connected: boolean;
	busy: boolean;
	onTarget(id: string): void;
	onBrowse(path: string): void;
	onImport(): void;
	onCreate: Parameters<typeof RemoteProjectCreator>[0]["onCreate"];
	onClose(): void;
	serverError?: string | null;
}) {
	const { t } = useLingui();
	return (
		<WorkstationDialog
			title={t({ message: "Add project" })}
			onClose={onClose}
			error={serverError}
		>
			<div className="ws-dialog-body">
				<label className="ws-field">
					<Trans>Run on</Trans>
					<select
						value={selectedId}
						disabled={busy}
						onChange={(e) => onTarget(e.target.value)}
					>
						{profiles.map((p) => (
							<option key={p.id} value={p.id}>
								{p.kind === "local" ? t({ message: "Local Device" }) : p.name}
							</option>
						))}
					</select>
				</label>
				{connected && directory ? (
					<>
						<RemoteDirectoryBrowser
							key={`${selectedId}:${directory.path}`}
							directory={directory}
							busy={busy}
							onBrowse={onBrowse}
						/>
						<button
							type="button"
							className="ws-button primary"
							disabled={busy}
							onClick={onImport}
						>
							<Plus size={14} />
							<Trans>Import this repository</Trans>
						</button>
						<RemoteProjectCreator
							parentDir={directory.path}
							busy={busy}
							onCreate={onCreate}
						/>
					</>
				) : (
					<p className="ws-description">
						<Trans>Connect to view workspaces</Trans>
					</p>
				)}
			</div>
			<div className="ws-dialog-footer">
				<button type="button" className="ws-button" onClick={onClose}>
					<Trans>Close</Trans>
				</button>
			</div>
		</WorkstationDialog>
	);
}
