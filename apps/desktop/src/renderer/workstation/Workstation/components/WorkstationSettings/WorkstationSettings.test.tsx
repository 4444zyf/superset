import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
	BROWSER_IMPORT_BANNER_ID,
	useBrowserImportBannerDismissalsStore,
} from "renderer/stores/browser-import-banner-dismissals";
import type { BrowserImportApi } from "shared/browser-import";
import type { WorkstationPreferenceSnapshot } from "../../../../../shared/workstation-preferences";
import type { BrowserPreferencesState } from "../../hooks/useBrowserPreferences";
import { WorkstationBrowserImport } from "../../providers/WorkstationBrowserImport";
import { WorkstationSettings } from "./WorkstationSettings";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
beforeAll(() => {
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: { ready: Promise.resolve() },
	});
});
afterAll(() => {
	if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
	else Reflect.deleteProperty(document, "fonts");
});

afterEach(() => {
	cleanup();
	useBrowserImportBannerDismissalsStore
		.getState()
		.reset(BROWSER_IMPORT_BANNER_ID);
});
const snapshot: WorkstationPreferenceSnapshot = {
	revision: 0,
	invalid: false,
	values: {
		agentNativeInputEnabled: false,
		language: null,
		themeId: "dark",
		fontSettings: {},
		fileOpenMode: "split-pane",
		fileAutoSave: "off",
		confirmOnQuit: true,
		terminalCopyOnSelect: false,
	},
};

test("the original typography controls write only the selected preference field", async () => {
	const patches: unknown[] = [];
	render(
		<WorkstationSettings
			open
			onOpenChange={() => {}}
			snapshot={snapshot}
			saving={false}
			error={null}
			onUpdate={async (patch) => {
				patches.push(patch);
			}}
			onReload={async () => {}}
		/>,
	);
	const size = screen.getByRole("spinbutton", {
		name: "Terminal typography font size",
	});
	fireEvent.change(size, { target: { value: "18" } });
	fireEvent.blur(size);
	await waitFor(() =>
		expect(patches).toEqual([{ fontSettings: { terminalFontSize: 18 } }]),
	);
});

test("unknown or unreadable preferences disable editing and offer an explicit reload", () => {
	let reads = 0;
	render(
		<WorkstationSettings
			open
			onOpenChange={() => {}}
			snapshot={{ ...snapshot, invalid: true }}
			saving={false}
			error="Read failed"
			onUpdate={async () => {
				throw new Error("must not mutate");
			}}
			onReload={async () => {
				reads++;
			}}
		/>,
	);
	expect(
		screen
			.getByRole("spinbutton", { name: "Terminal typography font size" })
			.hasAttribute("disabled"),
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(reads).toBe(1);
	expect(screen.getByRole("alert").textContent).toContain("Read failed");
});

test("a pending preference save disables all typography mutations", () => {
	const patches: unknown[] = [];
	render(
		<WorkstationSettings
			open
			onOpenChange={() => {}}
			snapshot={{
				...snapshot,
				values: {
					...snapshot.values,
					fontSettings: { terminalFontSize: 18, editorFontSize: 18 },
				},
			}}
			saving
			error={null}
			onUpdate={async (patch) => {
				patches.push(patch);
			}}
			onReload={async () => {}}
		/>,
	);
	const reset = screen.getAllByRole("button", {
		name: /Reset (editor|terminal)/,
	});
	for (const button of reset) {
		expect(button.hasAttribute("disabled")).toBe(true);
		fireEvent.click(button);
	}
	expect(patches).toEqual([]);
});

const browserPreferences: BrowserPreferencesState = {
	available: true,
	loading: false,
	saving: true,
	error: null,
	snapshot: null,
	reload: async () => {},
	update: async () => {
		throw new Error("Import must not write browser preferences");
	},
	reset: async () => {},
};
test("settings imports remain visible and protected while pending after the settings parent unmounts", async () => {
	let finish!: (value: { imported: number }) => void;
	let reads = 0,
		writes = 0;
	const source: BrowserImportApi = {
		getSources: async () => {
			reads++;
			return {
				needsFullDiskAccess: false,
				sources: [
					{
						id: "/owned/profile",
						browserKey: "chrome",
						browserName: "Chrome",
						profileName: "Owned",
					},
				],
			};
		},
		importHistory: () => {
			writes++;
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
		importCookies: async () => ({
			imported: 0,
			skipped: 0,
			keyUnavailable: true,
		}),
		requestFullDiskAccess: async () => {},
	};
	function Host() {
		const [settingsOpen, setSettingsOpen] = useState(true);
		return (
			<WorkstationBrowserImport source={source}>
				{settingsOpen && (
					<WorkstationSettings
						open
						onOpenChange={setSettingsOpen}
						snapshot={snapshot}
						saving={false}
						error={null}
						onUpdate={async () => {}}
						onReload={async () => {}}
						browserPreferences={browserPreferences}
					/>
				)}
			</WorkstationBrowserImport>
		);
	}
	render(<Host />);
	expect(reads).toBe(0);
	const open = screen.getByRole("button", { name: "Import…" });
	expect(open.hasAttribute("disabled")).toBe(false);
	await act(async () => fireEvent.click(open));
	expect(reads).toBe(1);
	expect(document.querySelectorAll("#import-history").length).toBe(1);
	expect(screen.getAllByRole("dialog").length).toBe(2);
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Import" })),
	);
	expect(writes).toBe(1);
	const parentClose = document.querySelector<HTMLElement>(
		"[data-workstation-settings] [data-slot=dialog-close]",
	);
	if (!parentClose) throw Error("Settings close missing");
	await act(async () => fireEvent.click(parentClose));
	expect(document.querySelector("[data-workstation-settings]")).toBeNull();
	expect(screen.getAllByRole("dialog").length).toBe(1);
	expect(
		screen.getByRole("button", { name: "Importing…" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Close" })),
	);
	expect(screen.getAllByRole("dialog").length).toBe(1);
	await act(async () => finish({ imported: 1 }));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(writes).toBe(1);
	expect(
		useBrowserImportBannerDismissalsStore
			.getState()
			.isDismissed(BROWSER_IMPORT_BANNER_ID),
	).toBe(true);
});
test("settings omit the import action when the connected desktop does not expose import data", () => {
	render(
		<WorkstationBrowserImport>
			<WorkstationSettings
				open
				onOpenChange={() => {}}
				snapshot={snapshot}
				saving={false}
				error={null}
				onUpdate={async () => {}}
				onReload={async () => {}}
				browserPreferences={browserPreferences}
			/>
		</WorkstationBrowserImport>,
	);
	expect(screen.queryByRole("button", { name: "Import…" })).toBeNull();
});

test.each([
	"cancel",
	"empty",
	"failed",
])("%s imports leave the global browser import offer available", async (outcome) => {
	let writes = 0;
	const source: BrowserImportApi = {
		getSources: async () => ({
			needsFullDiskAccess: false,
			sources: [
				{
					id: "/owned/profile",
					browserKey: "chrome",
					browserName: "Chrome",
					profileName: "Owned",
				},
			],
		}),
		importHistory: async () => {
			writes++;
			if (outcome === "failed") throw Error("Owned read failed");
			return { imported: 0 };
		},
		importCookies: async () => ({
			imported: 0,
			skipped: 0,
			keyUnavailable: true,
		}),
		requestFullDiskAccess: async () => {},
	};
	render(
		<WorkstationBrowserImport source={source}>
			<WorkstationSettings
				open
				onOpenChange={() => {}}
				snapshot={snapshot}
				saving={false}
				error={null}
				onUpdate={async () => {}}
				onReload={async () => {}}
				browserPreferences={browserPreferences}
			/>
		</WorkstationBrowserImport>,
	);
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "Import…" })),
	);
	expect(writes).toBe(0);
	await act(async () =>
		fireEvent.click(
			screen.getByRole("button", {
				name: outcome === "cancel" ? "Cancel" : "Import",
			}),
		),
	);
	expect(writes).toBe(outcome === "cancel" ? 0 : 1);
	expect(
		useBrowserImportBannerDismissalsStore
			.getState()
			.isDismissed(BROWSER_IMPORT_BANNER_ID),
	).toBe(false);
});
