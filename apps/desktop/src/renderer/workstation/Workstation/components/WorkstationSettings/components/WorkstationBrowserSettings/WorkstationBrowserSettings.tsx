import { BrowserImportSettingView } from "renderer/routes/_authenticated/settings/browser/components/BrowserSettings/components/BrowserImportSettingView";
import { useWorkstationBrowserImport } from "../../../../providers/WorkstationBrowserImport";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useEffect, useState, type Ref } from "react";
import { BrowserHomepageSettingView } from "renderer/routes/_authenticated/settings/browser/components/BrowserSettings/components/BrowserHomepageSettingView";
import { BrowserLinkSettingsView } from "renderer/routes/_authenticated/settings/browser/components/BrowserSettings/components/BrowserLinkSettings/components/BrowserLinkSettingsView";
import { SettingsSection } from "renderer/routes/_authenticated/settings/components/SettingsSection";
import {
	browserLinkActionSchema,
	browserLinkTierMapSchema,
	type BrowserPreferencePatch,
} from "shared/workstation-browser-preferences";
import type { BrowserPreferencesState } from "../../../../hooks/useBrowserPreferences";

export function WorkstationBrowserSettings({
	preferences,
	sectionRef,
}: {
	preferences: BrowserPreferencesState;
	sectionRef?: Ref<HTMLElement>;
}) {
	const { t } = useLingui();
	const openImport = useWorkstationBrowserImport();
	const values = preferences.snapshot?.values;
	const [draft, setDraft] = useState("");
	useEffect(() => setDraft(values?.homepageUrl ?? ""), [values?.homepageUrl]);
	if (!preferences.available) return null;
	const disabled =
		!values ||
		preferences.snapshot?.invalid ||
		preferences.saving ||
		preferences.loading;
	const update = (patch: BrowserPreferencePatch) => {
		if (!disabled) void preferences.update(patch).catch(() => {});
	};
	return (
		<section ref={sectionRef} data-workstation-browser-preferences>
			<SettingsSection title={t({ message: "Browser" })}>
				{preferences.error && (
					<output role="alert" className="text-destructive">
						{preferences.error}
					</output>
				)}
				{preferences.snapshot?.invalid && (
					<output role="alert" className="text-destructive">
						<Trans>
							Browser settings are invalid. Restore defaults to continue.
						</Trans>
					</output>
				)}
				{(!values || preferences.error) && (
					<Button
						variant="outline"
						size="sm"
						disabled={preferences.saving || preferences.loading}
						onClick={() => {
							void preferences.reload().catch(() => {});
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				)}
				{preferences.snapshot?.invalid && (
					<Button
						variant="outline"
						size="sm"
						disabled={preferences.saving || preferences.loading}
						onClick={() => {
							void preferences.reset().catch(() => {});
						}}
					>
						<Trans>Restore defaults</Trans>
					</Button>
				)}
				<BrowserHomepageSettingView
					draft={draft}
					onDraftChange={setDraft}
					disabled={disabled}
					onCommit={() => {
						const homepageUrl = draft.trim() || null;
						if (homepageUrl !== values?.homepageUrl) update({ homepageUrl });
					}}
				/>
				{openImport && <BrowserImportSettingView onImport={openImport} />}
				{values && (
					<BrowserLinkSettingsView
						showPortDescription={false}
						urlDescription={t({ message: "Applies to URLs in terminals." })}
						disabled={disabled}
						urlLinks={values.urlLinks}
						portOpenAction={values.portOpenAction}
						onUrlLinks={(next) =>
							update({ urlLinks: browserLinkTierMapSchema.parse(next) })
						}
						onPortOpenAction={(next) =>
							update({ portOpenAction: browserLinkActionSchema.parse(next) })
						}
					/>
				)}
			</SettingsSection>
		</section>
	);
}
