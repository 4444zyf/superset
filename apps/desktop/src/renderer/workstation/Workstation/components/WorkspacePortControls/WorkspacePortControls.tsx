import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";

export function WorkspacePortControls({
	busy,
	forward,
	onOpenPort,
	onClosePort,
}: {
	busy: boolean;
	forward: { id: string; url: string } | null;
	onOpenPort(port: number): void;
	onClosePort(): void;
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
			{forward && (
				<div className="flex items-center gap-2">
					<code className="text-xs">{forward.url}</code>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onClosePort}
						disabled={busy}
					>
						<Trans>Close</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}
