import { expect, test } from "bun:test";
import { transferPaneToSplit } from "@superset/panes";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import {
	createWorkspacePaneAreas,
	type WorkspacePaneAreasState,
} from "../workspace-pane-areas/workspace-pane-areas";
import { createWorkspacePaneAreaEdits } from "./workspace-pane-area-edits";

function setup(save: () => Promise<unknown> = async () => {}) {
	const areas = createWorkspacePaneAreas(workspace(fixture()), {
		scheduleMicrotask() {},
	});
	transferPaneToSplit({
		source: areas.right,
		target: areas.center,
		paneId: "browser",
		targetPaneId: "terminal",
		position: "right",
	});
	areas.center
		.getState()
		.resizeSplit({ tabId: "center-tab", path: [], splitPercentage: 50 });
	areas.flush();
	const writes: {
			next: WorkspacePaneAreasState;
			before: WorkspacePaneAreasState;
		}[] = [],
		timers = new Set<() => void>(),
		delays: number[] = [],
		errors: unknown[] = [];
	const edits = createWorkspacePaneAreaEdits({
		save(next, before) {
			writes.push({ next, before });
			return save();
		},
		onError: (error) => errors.push(error),
		schedule(callback, delay) {
			timers.add(callback);
			delays.push(delay);
			return () => {
				timers.delete(callback);
			};
		},
	});
	const off = areas.subscribeEdits((next, before) => edits.push(next, before));
	return {
		areas,
		edits,
		writes,
		timers,
		delays,
		errors,
		resize(value: number) {
			areas.center
				.getState()
				.resizeSplit({ tabId: "center-tab", path: [], splitPercentage: value });
			areas.flush();
		},
		title() {
			areas.center.getState().setPaneTitleOverride({
				tabId: "center-tab",
				paneId: "terminal",
				titleOverride: "Changed",
			});
			areas.flush();
		},
		dispose() {
			off();
			edits.dispose();
			areas.dispose();
		},
	};
}
const percent = (state: WorkspacePaneAreasState) => {
	const layout = state.center.tabs[0]?.layout;
	return layout?.type === "split" ? layout.splitPercentage : undefined;
};
test("consecutive original resize events retain the first before and last next under the original 250ms debounce", async () => {
	const f = setup();
	try {
		f.resize(60);
		f.resize(70);
		expect(f.writes).toHaveLength(0);
		expect(f.timers.size).toBe(1);
		expect(f.delays).toEqual([250, 250]);
		const callbacks = [...f.timers];
		f.timers.clear();
		for (const callback of callbacks) callback();
		await f.edits.flush();
		expect(f.writes).toHaveLength(1);
		expect(percent(required(f.writes[0]).before)).toBe(50);
		expect(percent(required(f.writes[0]).next)).toBe(70);
		expect(f.timers.size).toBe(0);
	} finally {
		f.dispose();
	}
});
test("a metadata edit includes the entire pending resize and obsolete callbacks cannot save it again", async () => {
	const f = setup();
	try {
		f.resize(65);
		const old = [...f.timers];
		f.title();
		expect(f.writes).toHaveLength(1);
		expect(percent(required(f.writes[0]).before)).toBe(50);
		expect(percent(required(f.writes[0]).next)).toBe(65);
		expect(
			f.writes[0]?.next.center.tabs[0]?.panes.terminal?.titleOverride,
		).toBe("Changed");
		for (const callback of old) callback();
		await f.edits.flush();
		expect(f.writes).toHaveLength(1);
		expect(f.timers.size).toBe(0);
	} finally {
		f.dispose();
	}
});
test("returning to the original geometry cancels a pending write", async () => {
	const f = setup();
	try {
		f.resize(60);
		f.resize(50);
		await f.edits.flush();
		expect(f.writes).toHaveLength(0);
		expect(f.timers.size).toBe(0);
	} finally {
		f.dispose();
	}
});
test("flush dispatches pending geometry immediately and waits for the owned save to finish", async () => {
	const gate = Promise.withResolvers<void>(),
		f = setup(() => gate.promise);
	try {
		f.resize(72);
		let finished = false;
		const flush = f.edits.flush().then(() => {
			finished = true;
		});
		expect(f.writes).toHaveLength(1);
		expect(finished).toBe(false);
		gate.resolve();
		await flush;
		expect(finished).toBe(true);
		expect(f.timers.size).toBe(0);
	} finally {
		gate.resolve();
		f.dispose();
	}
});
test("dispose prevents old layout timers from saving a retired workspace", async () => {
	const f = setup();
	f.resize(66);
	const callbacks = [...f.timers];
	f.dispose();
	for (const callback of callbacks) callback();
	await f.edits.flush();
	expect(f.writes).toHaveLength(0);
	expect(f.timers.size).toBe(0);
});
test("an owned save failure is reported and flush rejects without an automatic retry", async () => {
	const error = Error("owned save failure"),
		f = setup(async () => {
			throw error;
		});
	try {
		f.resize(68);
		await expect(f.edits.flush()).rejects.toBe(error);
		expect(f.errors).toEqual([error]);
		expect(f.writes).toHaveLength(1);
	} finally {
		f.dispose();
	}
});
