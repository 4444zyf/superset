import { Trans } from "@lingui/react/macro";
import { ArrowUp, Folder } from "lucide-react";
import type { RemoteDirectory } from "../../types";
export function RemoteDirectoryBrowser({
	directory,
	busy,
	onBrowse,
}: {
	directory: RemoteDirectory;
	busy: boolean;
	onBrowse(path: string): void;
}) {
	return (
		<div data-remote-directory-browser>
			<form
				className="ws-path-form"
				key={directory.path}
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
						onClick={() => onBrowse(directory.parentPath ?? directory.path)}
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
		</div>
	);
}
