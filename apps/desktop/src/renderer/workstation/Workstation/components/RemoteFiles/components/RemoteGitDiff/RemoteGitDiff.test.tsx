import { afterEach, expect, test } from "bun:test";
import { TooltipProvider } from "@superset/ui/tooltip";
import { cleanup, render, waitFor } from "@testing-library/react";
import { WorkstationPreferencesContext } from "../../../../providers/WorkstationPreferencesContext";
import { RemoteGitDiff } from "./RemoteGitDiff";

afterEach(cleanup);

test("original diff rendering follows workstation editor font changes without Electron or account providers", async () => {
	const values = {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "light",
		fontSettings: { editorFontFamily: "monospace", editorFontSize: 17 },
		fileOpenMode: "split-pane" as const,
		fileAutoSave: "off" as const,
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	};
	const content = (size: number) => (
		<TooltipProvider>
			<WorkstationPreferencesContext
				value={{
					revision: size,
					invalid: false,
					values: {
						...values,
						fontSettings: { ...values.fontSettings, editorFontSize: size },
					},
				}}
			>
				<RemoteGitDiff path="note.txt" original="before" modified="after" />
			</WorkstationPreferencesContext>
		</TooltipProvider>
	);
	const view = render(content(17));
	await waitFor(() =>
		expect(
			document
				.querySelector<HTMLElement>("diffs-container")
				?.style.getPropertyValue("--diffs-font-size"),
		).toBe("17px"),
	);
	expect(
		document
			.querySelector<HTMLElement>("diffs-container")
			?.style.getPropertyValue("--diffs-font-family"),
	).toBe("monospace");
	view.rerender(content(19));
	await waitFor(() =>
		expect(
			document
				.querySelector<HTMLElement>("diffs-container")
				?.style.getPropertyValue("--diffs-font-size"),
		).toBe("19px"),
	);
	await waitFor(() =>
		expect(
			document
				.querySelector("diffs-container")
				?.shadowRoot?.querySelector(
					'[data-line][data-line-type="change-addition"]',
				)
				?.textContent?.trim(),
		).toBe("after"),
	);
});
