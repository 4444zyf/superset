import { Trans } from "@lingui/react/macro";
import { Label } from "@superset/ui/label";
import { Switch } from "@superset/ui/switch";
import { useId } from "react";

export function RunSetupScriptOption({
	id,
	checked,
	disabled,
	onCheckedChange,
}: {
	id?: string;
	checked: boolean;
	disabled?: boolean;
	onCheckedChange(checked: boolean): void;
}) {
	const generatedId = useId();
	const inputId = id ?? generatedId;
	return (
		<div className="flex items-center justify-between">
			<Label htmlFor={inputId} className="text-xs text-muted-foreground">
				<Trans>Run setup script</Trans>
			</Label>
			<Switch
				id={inputId}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}
