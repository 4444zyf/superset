import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteWorkspacePorts } from "../RemoteWorkspacePorts";

export function WorkspacePortControls({
	api,
	connection,
	workspaceId,
	busy,
	forward,
	forwards,
	onOpenPort,
	onCopyPort,
	onClosePort,
}: {
	api?: DirectWorkstationApi;
	connection?: DirectDescriptor | null;
	workspaceId?: string;
	busy: boolean;
	forward: { id: string; url: string } | null;
	forwards?: { id: string; url: string; workspaceId?: string; port?: number }[];
	onOpenPort(port: number): void;
	onCopyPort?(port: number): Promise<void>;
	onClosePort(id?: string): void;
}) {
	const { t } = useLingui();
	return (
		<div className="space-y-2">
			<form
				className="flex items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					onOpenPort(Number(new FormData(event.currentTarget).get("port")));
				}}
			>
				<Input
					name="port"
					type="number"
					min={1}
					max={65535}
					required
					aria-label={t({ message: "Port" })}
					placeholder={t({ message: "Port" })}
					className="w-28 h-8"
					disabled={busy}
				/>
				<Button type="submit" variant="outline" size="sm" disabled={busy}>
					<Trans>Open port</Trans>
				</Button>
			</form>
			{(forwards ?? (forward ? [forward] : [])).map((entry) => (
				<div
					key={entry.id}
					data-forward-id={entry.id}
					data-forward-port={"port" in entry ? entry.port : undefined}
					className="flex items-center gap-2"
				>
					<code className="text-xs">{entry.url}</code>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => (forwards ? onClosePort(entry.id) : onClosePort())}
						disabled={busy}
					>
						<Trans>Close</Trans>
					</Button>
				</div>
			))}
			{api && connection && workspaceId && (
				<RemoteWorkspacePorts
					api={api}
					connection={connection}
					workspaceId={workspaceId}
					busy={busy}
					onOpenPort={onOpenPort}
					onCopyPort={onCopyPort}
				/>
			)}
		</div>
	);
}
