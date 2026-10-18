import { Trans } from "@lingui/react/macro";
import { Bot } from "lucide-react";
export function AgentSettingsEmptyState() {
	return (
		<div className="flex h-full items-center justify-center p-6">
			<div className="text-center">
				<Bot
					aria-hidden="true"
					className="mx-auto size-10 text-muted-foreground/60"
				/>
				<h3 className="mt-3 text-sm font-medium">
					<Trans>No agents yet</Trans>
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					<Trans>Add one from the menu in the sidebar to get started.</Trans>
				</p>
			</div>
		</div>
	);
}
