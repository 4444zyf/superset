import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUp, Folder, Plus } from "lucide-react";
import type { DirectProfile, RemoteDirectory } from "../../types";
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
						<form
							className="ws-path-form"
							key={`${selectedId}:${directory.path}`}
							onSubmit={(e) => {
								e.preventDefault();
								onBrowse(String(new FormData(e.currentTarget).get("path")));
							}}
						>
							<label className="ws-field">
								<Trans>Path</Trans>
								<input name="path" defaultValue={directory.path} required />
							</label>
							<button className="ws-button" disabled={busy} type="submit">
								<Trans>Open</Trans>
							</button>
						</form>
						<div className="ws-directory-list">
							{directory.parentPath && (
								<button
									type="button"
									className="ws-button small"
									disabled={busy}
									onClick={() =>
										onBrowse(directory.parentPath ?? directory.path)
									}
								>
									<ArrowUp size={14} />
									..
								</button>
							)}
							{directory.entries
								.filter((e) => e.isDirectory || e.isSymlink)
								.map((e) => (
									<button
										type="button"
										className="ws-button small"
										disabled={busy}
										key={e.name}
										onClick={() => onBrowse(`${directory.path}/${e.name}`)}
									>
										<Folder size={14} />
										{e.name}
									</button>
								))}
						</div>
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
