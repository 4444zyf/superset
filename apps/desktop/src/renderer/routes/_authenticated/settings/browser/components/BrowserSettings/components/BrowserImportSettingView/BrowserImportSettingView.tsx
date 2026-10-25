import { Trans, useLingui } from "@lingui/react/macro";
import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import { Button } from "@superset/ui/button";
import { Label } from "@superset/ui/label";
import { TbDownload } from "react-icons/tb";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";

export function BrowserImportSettingView({
	onImport,
	searchQuery = "",
	productName = PRODUCT_BRAND.displayName,
}: {
	onImport(): void;
	searchQuery?: string;
	productName?: string;
}) {
	const { t } = useLingui();
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="space-y-0.5">
				<Label className="text-sm font-medium">
					<HighlightText
						text={t({
							message: "Import settings from another browser",
						})}
						query={searchQuery}
					/>
				</Label>
				<p className="text-xs text-muted-foreground">
					<Trans>
						Copy browsing history and logins from Chrome, Brave, Arc, or another
						Chromium browser into {productName}.
					</Trans>
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				className="gap-2 shrink-0"
				onClick={onImport}
			>
				<TbDownload className="size-4" />
				<Trans>Import…</Trans>
			</Button>
		</div>
	);
}
