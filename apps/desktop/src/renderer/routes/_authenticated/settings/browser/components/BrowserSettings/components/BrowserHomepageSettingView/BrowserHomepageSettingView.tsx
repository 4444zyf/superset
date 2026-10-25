import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";
export function BrowserHomepageSettingView({
	draft,
	onDraftChange,
	onCommit,
	disabled = false,
	searchQuery = "",
}: {
	draft: string;
	onDraftChange(value: string): void;
	onCommit(): void;
	disabled?: boolean;
	searchQuery?: string;
}) {
	const { t } = useLingui();
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="space-y-0.5">
				<Label htmlFor="browser-homepage" className="text-sm font-medium">
					<HighlightText
						text={t({
							message: "Browser homepage",
						})}
						query={searchQuery}
					/>
				</Label>
				<p className="text-xs text-muted-foreground">
					<Trans>
						The page new in-app browser tabs open to. Leave empty for a blank
						page.
					</Trans>
				</p>
			</div>
			<Input
				id="browser-homepage"
				className="w-[260px]"
				placeholder="about:blank"
				value={draft}
				disabled={disabled}
				onChange={(event) => onDraftChange(event.target.value)}
				onBlur={onCommit}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>
		</div>
	);
}
