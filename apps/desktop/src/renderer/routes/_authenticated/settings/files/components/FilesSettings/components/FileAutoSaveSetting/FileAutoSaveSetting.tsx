import { Trans, useLingui } from "@lingui/react/macro";
import type { FileAutoSaveMode } from "@superset/shared/file-settings";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";
import { useSettingsSearchQuery } from "renderer/stores/settings-state";

export function FileAutoSaveSetting({
	mode,
	disabled,
	onChange,
}: {
	mode: FileAutoSaveMode;
	disabled?: boolean;
	onChange(mode: FileAutoSaveMode): void;
}) {
	const { t } = useLingui();
	const searchQuery = useSettingsSearchQuery();
	return (
		<div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
			<div className="space-y-0.5">
				<Label htmlFor="file-auto-save" className="text-sm font-medium">
					<HighlightText
						text={t({ message: "Auto Save" })}
						query={searchQuery}
					/>
				</Label>
				<p className="text-xs text-muted-foreground">
					<Trans>Controls when manually edited files are saved</Trans>
				</p>
			</div>
			<Select
				value={mode}
				onValueChange={(value) => onChange(value as FileAutoSaveMode)}
				disabled={disabled}
			>
				<SelectTrigger id="file-auto-save" className="w-[180px]">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="off">
						<Trans>Off</Trans>
					</SelectItem>
					<SelectItem value="afterDelay">
						<Trans>After delay (3s)</Trans>
					</SelectItem>
					<SelectItem value="onFocusChange">
						<Trans>On focus change</Trans>
					</SelectItem>
					<SelectItem value="onWindowChange">
						<Trans>On window change</Trans>
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}
