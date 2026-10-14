import { Trans, useLingui } from "@lingui/react/macro";
import {
	isSupportedLocale,
	LOCALE_LABELS,
	SUPPORTED_LOCALES,
} from "@superset/i18n/locales";
import { builtInThemes, darkTheme } from "@superset/shared/themes";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Switch } from "@superset/ui/switch";
import { useMemo } from "react";
import { ThemeSwatch } from "renderer/components/ThemeSwatch";
import { EMPTY_FONT_SETTINGS } from "renderer/lib/font-settings";
import { TypographySurfaceCardView } from "renderer/routes/_authenticated/settings/appearance/components/AppearanceSettings/components/FontSettingSection/components/TypographySurfaceCard/components/TypographySurfaceCardView";
import { useSystemFonts } from "renderer/routes/_authenticated/settings/appearance/components/AppearanceSettings/components/FontSettingSection/hooks/useSystemFonts";
import { SettingsRow } from "renderer/routes/_authenticated/settings/components/SettingsRow";
import { SettingsSection } from "renderer/routes/_authenticated/settings/components/SettingsSection";
import type {
	WorkstationPreferencePatch,
	WorkstationPreferenceSnapshot,
} from "../../../../../shared/workstation-preferences";

export function WorkstationSettings({
	open,
	onOpenChange,
	snapshot,
	saving,
	error,
	onUpdate,
	onReload,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	snapshot: WorkstationPreferenceSnapshot | null;
	saving: boolean;
	error: string | null;
	onUpdate(patch: WorkstationPreferencePatch): Promise<unknown>;
	onReload(): Promise<unknown>;
}) {
	const { t } = useLingui();
	const { fonts, isLoading: fontsLoading } = useSystemFonts();
	const disabled = !snapshot || snapshot.invalid || saving;
	const values = snapshot?.values;
	const theme =
		builtInThemes.find((theme) => theme.id === values?.themeId) ?? darkTheme;
	const settings = useMemo(
		() => ({ ...EMPTY_FONT_SETTINGS, ...values?.fontSettings }),
		[values?.fontSettings],
	);
	const update = (patch: WorkstationPreferencePatch) => {
		if (!disabled) void onUpdate(patch).catch(() => {});
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
				data-workstation-settings
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Settings</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Appearance</Trans>
					</DialogDescription>
				</DialogHeader>
				{error && (
					<div role="alert" className="text-destructive">
						{error}
					</div>
				)}
				{(error || snapshot?.invalid || !snapshot) && (
					<Button
						onClick={() => {
							void onReload().catch(() => {});
						}}
						disabled={saving}
					>
						<Trans>Retry</Trans>
					</Button>
				)}
				<SettingsSection title={t({ message: "Appearance" })}>
					<SettingsRow
						label={t({ message: "Language" })}
						hint={t({
							message:
								"App display language. Auto follows your system language.",
						})}
					>
						<Select
							value={values?.language ?? "auto"}
							disabled={disabled}
							onValueChange={(value) => {
								if (value === "auto" || isSupportedLocale(value))
									update({ language: value === "auto" ? null : value });
							}}
						>
							<SelectTrigger
								id="workstation-language"
								aria-label={t({ message: "Language" })}
								className="min-w-44"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="auto">
									<Trans>Auto (system)</Trans>
								</SelectItem>
								{SUPPORTED_LOCALES.map((locale) => (
									<SelectItem key={locale} value={locale}>
										{LOCALE_LABELS[locale]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsRow>
					<SettingsRow label={t({ message: "Theme" })}>
						<Select
							value={theme.id}
							disabled={disabled}
							onValueChange={(themeId) => update({ themeId })}
						>
							<SelectTrigger
								id="workstation-theme"
								aria-label={t({ message: "Theme" })}
								className="min-w-44"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{builtInThemes.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										<div className="flex items-center gap-2">
											<ThemeSwatch theme={item} />
											{item.name}
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsRow>
				</SettingsSection>
				<SettingsSection title={t({ message: "Typography" })}>
					<fieldset
						disabled={disabled}
						className="min-w-0 rounded-lg border border-border divide-y divide-border"
					>
						{(["editor", "terminal"] as const).map((variant) => (
							<TypographySurfaceCardView
								key={variant}
								variant={variant}
								settings={settings}
								theme={theme}
								isLoading={disabled}
								onChange={(fontSettings) => update({ fontSettings })}
								fonts={fonts}
								fontsLoading={fontsLoading}
							/>
						))}
					</fieldset>
				</SettingsSection>
				<SettingsSection title={t({ message: "Terminal" })}>
					<SettingsRow
						htmlFor="workstation-copy-on-select"
						label={t({ message: "Copy on select" })}
					>
						<Switch
							id="workstation-copy-on-select"
							checked={values?.terminalCopyOnSelect ?? false}
							disabled={disabled}
							onCheckedChange={(terminalCopyOnSelect) =>
								update({ terminalCopyOnSelect })
							}
						/>
					</SettingsRow>
				</SettingsSection>
			</DialogContent>
		</Dialog>
	);
}
