import { expect, test } from "bun:test";
import { transferPaneToSplit, transferTabToIndex } from "@superset/panes";
import {
	fixture,
	required,
	workspace,
} from "../../../../../main/lib/ssh-direct/workspace-view-area-fixtures.test-data";
import {
	createWorkspacePaneAreas,
	readWorkspacePaneAreas,
	type WorkspacePaneAreasState,
	workspacePaneAreasStructureKey,
} from "./workspace-pane-areas";

function runtime() {
	const scheduled: (() => void)[] = [],
		events: {
			next: WorkspacePaneAreasState;
			before: WorkspacePaneAreasState;
		}[] = [];
	const areas = createWorkspacePaneAreas(workspace(fixture()), {
		scheduleMicrotask: (callback) => {
			scheduled.push(callback);
		},
	});
	areas.subscribeEdits((next, before) => {
		events.push({ next, before });
	});
	return {
		areas,
		scheduled,
		events,
		drain() {
			for (const callback of scheduled.splice(0)) callback();
			expect(scheduled).toHaveLength(0);
		},
	};
}
const resources = (state: WorkspacePaneAreasState) =>
	[state.center, state.right].flatMap((s) =>
		s.tabs.flatMap((t) =>
			Object.values(t.panes).map((p) => [
				p.id,
				p.data.resourceId,
				p.data.executionId,
			]),
		),
	);

test("the original pane store codec restores independent selections and explicit true/false pins", () => {
	const view = fixture(),
		w = workspace(view),
		before = structuredClone(w);
	const state = readWorkspacePaneAreas(w);
	expect(state.center.activeTabId).toBe("center-tab");
	expect(state.right.activeTabId).toBe("right-tab");
	expect(state.center.tabs[0]?.panes.terminal?.pinned).toBe(true);
	expect(state.right.tabs[0]?.panes.browser?.pinned).toBe(false);
	expect(state.activePaneArea).toBe("center");
	expect(state.rightPaneOpen).toBe(false);
	expect(w).toEqual(before);
});
test("an original cross-store tab transfer publishes once after both stores finish", () => {
	const f = runtime();
	try {
		transferTabToIndex({
			source: f.areas.center,
			target: f.areas.right,
			tabId: "center-tab",
		});
		expect(f.events).toHaveLength(0);
		expect(f.scheduled).toHaveLength(1);
		f.drain();
		expect(f.events).toHaveLength(1);
		const event = required(f.events[0]);
		expect(resources(event.before)).toEqual([
			["terminal", "pty", "execution"],
			["browser", "browser-resource", undefined],
		]);
		expect(resources(event.next)).toEqual([
			["browser", "browser-resource", undefined],
			["terminal", "pty", "execution"],
		]);
		expect(event.next.center.tabs).toEqual([]);
		expect(f.areas.right.getState().getPane("terminal")?.pane.pinned).toBe(
			true,
		);
	} finally {
		f.areas.dispose();
	}
});
test("the original pane-to-split transfer retains a single copy of each execution", () => {
	const f = runtime();
	try {
		transferPaneToSplit({
			source: f.areas.center,
			target: f.areas.right,
			paneId: "terminal",
			targetPaneId: "browser",
			position: "bottom",
		});
		f.areas.activate("right");
		f.drain();
		expect(f.events).toHaveLength(1);
		expect(f.areas.read().activePaneArea).toBe("right");
		expect(f.areas.read().rightPaneOpen).toBe(true);
		expect(resources(f.areas.read())).toHaveLength(2);
		expect(
			f.areas.right.getState().getPane("terminal")?.pane.data.executionId,
		).toBe("execution");
		expect(f.areas.right.getState().getPane("terminal")?.pane.pinned).toBe(
			true,
		);
	} finally {
		f.areas.dispose();
	}
});
test("revealing does not steal focus and hiding the active right area preserves its tabs", () => {
	const f = runtime();
	try {
		f.areas.setRightPaneOpen(true);
		expect(f.areas.read().activePaneArea).toBe("center");
		f.areas.activate("right");
		f.drain();
		expect(f.events).toHaveLength(1);
		f.areas.setRightPaneOpen(false);
		f.drain();
		expect(f.areas.read().activePaneArea).toBe("center");
		expect(f.areas.read().right.activeTabId).toBe("right-tab");
		expect(resources(f.areas.read())).toHaveLength(2);
	} finally {
		f.areas.dispose();
	}
});
test("removing the last right tab cannot leave focus in an empty area", () => {
	const f = runtime();
	try {
		f.areas.activate("right");
		f.drain();
		f.events.length = 0;
		f.areas.right.getState().removeTab("right-tab");
		f.drain();
		expect(f.events[0]?.before.activePaneArea).toBe("right");
		expect(f.events[0]?.next.activePaneArea).toBe("center");
		expect(f.areas.read().rightPaneOpen).toBe(true);
		expect(f.areas.activate("right")).toBe(false);
	} finally {
		f.areas.dispose();
	}
});
test("synchronization flushes a pending pin intent and accepts authoritative snapshot pins", () => {
	const f = runtime();
	try {
		f.areas.center
			.getState()
			.setPanePinned({ paneId: "terminal", pinned: false });
		f.areas.synchronize(workspace(fixture()));
		expect(f.events).toHaveLength(1);
		expect(f.events[0]?.next.center.tabs[0]?.panes.terminal?.pinned).toBe(
			false,
		);
		const updated = workspace(fixture());
		required(updated.panes[0]).pinned = false;
		f.areas.synchronize(updated);
		f.drain();
		expect(f.events).toHaveLength(1);
		expect(f.areas.center.getState().getPane("terminal")?.pane.pinned).toBe(
			false,
		);
	} finally {
		f.areas.dispose();
	}
});
test("same-data store notifications do not publish a false edit", () => {
	const f = runtime();
	try {
		f.areas.center.setState({ ...f.areas.center.getState() });
		f.drain();
		expect(f.events).toEqual([]);
	} finally {
		f.areas.dispose();
	}
});
test("reaffirming unchanged area flags cannot create snapshot feedback", () => {
	const f = runtime();
	let notifications = 0;
	try {
		f.areas.subscribe(() => {
			notifications++;
			f.areas.activate("center");
		});
		f.areas.setRightPaneOpen(false);
		f.areas.activate("center");
		f.drain();
		expect(notifications).toBe(0);
		expect(f.events).toEqual([]);
	} finally {
		f.areas.dispose();
	}
});
test("disposing drops old pending notifications and blocks stale mutations", () => {
	const f = runtime();
	f.areas.center
		.getState()
		.setPanePinned({ paneId: "terminal", pinned: false });
	f.areas.dispose();
	f.drain();
	expect(f.events).toEqual([]);
	f.areas.activate("right");
	f.areas.setRightPaneOpen(true);
	expect(f.areas.read().rightPaneOpen).toBe(false);
	expect(f.areas.read().activePaneArea).toBe("center");
});
test("an old subscription cleanup cannot remove a later registration of the same callback", () => {
	const f = runtime();
	let calls = 0;
	try {
		const listener = () => {
			calls++;
		};
		const old = f.areas.subscribe(listener);
		old();
		const current = f.areas.subscribe(listener);
		old();
		f.areas.setRightPaneOpen(true);
		f.drain();
		expect(calls).toBe(1);
		current();
	} finally {
		f.areas.dispose();
	}
});

test("snapshot subscriptions see synchronized data without echoing a user edit", () => {
	const f = runtime();
	let notifications = 0;
	try {
		f.areas.subscribe(() => {
			notifications++;
		});
		const before = f.areas.read(),
			updated = workspace(fixture());
		updated.rightPaneOpen = true;
		required(updated.panes[0]).pinned = false;
		f.areas.synchronize(updated);
		expect(notifications).toBe(1);
		expect(f.events).toEqual([]);
		expect(f.areas.read()).not.toBe(before);
		expect(f.areas.read()).toBe(f.areas.read());
		expect(f.areas.read().rightPaneOpen).toBe(true);
	} finally {
		f.areas.dispose();
	}
});

test("the browser-open structure stamp ignores selections but includes right-side pins", () => {
	const f = runtime();
	try {
		const before = workspacePaneAreasStructureKey(f.areas.read());
		f.areas.activate("right");
		f.drain();
		expect(workspacePaneAreasStructureKey(f.areas.read())).toBe(before);
		f.areas.right.getState().setPanePinned({ paneId: "browser", pinned: true });
		f.drain();
		expect(workspacePaneAreasStructureKey(f.areas.read())).not.toBe(before);
	} finally {
		f.areas.dispose();
	}
});
