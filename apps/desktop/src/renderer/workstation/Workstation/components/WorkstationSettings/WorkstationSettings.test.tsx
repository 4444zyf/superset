import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { WorkstationPreferenceSnapshot } from "../../../../../shared/workstation-preferences";
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

afterEach(cleanup);
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
