import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { DirectProfile, RemoteProject } from "../../types";
import { WorkstationDialog } from "../WorkstationDialog/WorkstationDialog";

export function SessionDialog({
	profiles,
	selectedId,
	projects,
	connected,
	busy,
	onTarget,
	onCreate,
	onClose,
	serverError,
}: {
	profiles: DirectProfile[];
	selectedId: string;
	projects: RemoteProject[];
	connected: boolean;
	busy: boolean;
	onTarget(id: string): void;
	onCreate(name: string, projectId: string): void;
	onClose(): void;
	serverError?: string | null;
}) {
	const { t } = useLingui();
	const [name, setName] = useState("");
	const [project, setProject] = useState("");
	return (
		<WorkstationDialog
			title={t({ message: "New session" })}
			onClose={onClose}
			error={serverError}
		>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (
						connected &&
						!busy &&
						(!project || projects.some((p) => p.id === project))
					)
						onCreate(name.trim(), project);
				}}
			>
				<div className="ws-dialog-body">
					<label className="ws-field">
						<Trans>Name</Trans>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							maxLength={100}
						/>
					</label>
					<label className="ws-field">
						<Trans>Run on</Trans>
						<select
							value={selectedId}
							disabled={busy}
							onChange={(e) => {
								setProject("");
								onTarget(e.target.value);
							}}
						>
							{profiles.map((p) => (
								<option key={p.id} value={p.id}>
									{p.kind === "local" ? t({ message: "Local Device" }) : p.name}
								</option>
							))}
						</select>
					</label>
					<label className="ws-field">
						<Trans>Project</Trans>
						<select
							value={project}
							onChange={(e) => setProject(e.target.value)}
							disabled={busy || !connected}
						>
							<option value="">
								<Trans>Standalone session</Trans>
							</option>
							{connected &&
								projects.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
						</select>
					</label>
					<p className="ws-description">
						{connected ? (
							<Trans>Choose where your projects and sessions run.</Trans>
						) : (
							<Trans>Connect to view workspaces</Trans>
						)}
					</p>
				</div>
				<div className="ws-dialog-footer">
					<button
						type="button"
						className="ws-button"
						onClick={onClose}
						disabled={busy}
					>
						<Trans>Cancel</Trans>
					</button>
					<button
						type="submit"
						className="ws-button primary"
						disabled={busy || !connected || !name.trim()}
					>
						<Trans>Create</Trans>
					</button>
				</div>
			</form>
		</WorkstationDialog>
	);
}
