import { expect, test } from "bun:test";
import { clampDesignModePayload } from "main/lib/browser/design-mode-payload";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { DesignModeSelectionResult } from "shared/browser-design-mode";
import type { WorkstationBrowserDesignModeApi } from "shared/workstation-browser-design-mode";
import type { WorkstationBrowserEvent } from "shared/workstation-browser";
import { WorkstationBrowsers } from "./workstation-browsers";

async function drain() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}
function payload() {
	const result = clampDesignModePayload({
		page: { sanitizedUrl: "http://localhost/owned" },
		target: {
			tagName: "h1",
			selector: "h1",
			rectViewport: { x: 10, y: 20, width: 100, height: 32 },
		},
	});
	if (!result) throw Error("Invalid owned payload fixture");
	return result;
}
async function fixture(options?: { deferEnable?: boolean }) {
	let onEvent: (event: WorkstationBrowserEvent) => void = () => {};
	const ready = Promise.withResolvers<void>();
	const enable = Promise.withResolvers<{ ok: boolean }>();
	const selection = Promise.withResolvers<DesignModeSelectionResult>();
	const sets: Parameters<WorkstationBrowserDesignModeApi["set"]>[0][] = [];
	const awaits: Parameters<
		WorkstationBrowserDesignModeApi["awaitSelection"]
	>[0][] = [];
	const captures: Parameters<
		WorkstationBrowserDesignModeApi["screenshot"]
	>[0][] = [];
	const descriptor: DirectDescriptor = {
		connectionId: crypto.randomUUID(),
		generation: 2,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	};
	const api = {
		browser: {
			register: async () => {},
			unregister: async () => {},
			navigate: async () => {
				ready.resolve();
				return { status: "navigated" };
			},
			onEvent: (listener: typeof onEvent) => {
				onEvent = listener;
				return () => {};
			},
			designMode: {
				set: async (input: (typeof sets)[number]) => {
					sets.push(input);
					return options?.deferEnable && input.enabled
						? enable.promise
						: { ok: true };
				},
				awaitSelection: async (input: (typeof awaits)[number]) => {
					awaits.push(input);
					return selection.promise;
				},
				screenshot: async (input: (typeof captures)[number]) => {
					captures.push(input);
					return { screenshot: null };
				},
			},
		},
	} as unknown as DirectWorkstationApi;
	const runtime = new WorkstationBrowsers(api);
	const workspaceId = crypto.randomUUID();
	const id = runtime.ensure(
		descriptor,
		workspaceId,
		{
			kind: "browser",
			paneId: "owned",
			resourceId: crypto.randomUUID(),
			browser: { url: "about:blank", pageTitle: "", faviconUrl: null },
		},
		{
			onPersist() {},
			onClose() {},
			onFocus() {},
			onNewWindow() {},
			onFind() {},
			onError() {},
		},
	);
	const guest = runtime.core.openBackground(
		id,
		"about:blank",
		workspaceId,
		() => {},
	).webview;
	const container = guest.parentElement;
	Object.assign(guest, {
		getWebContentsId: () => 42,
		executeJavaScript: async () => {
			throw Error("Owned guest has no viewport stream");
		},
	});
	guest.dispatchEvent(new Event("dom-ready"));
	await ready.promise;
	const pane = runtime.registration(id);
	if (!pane) throw Error("Owned pane not registered");
	return {
		runtime,
		id,
		pane,
		guest,
		enable,
		selection,
		sets,
		awaits,
		captures,
		emit: (event: WorkstationBrowserEvent) => onEvent(event),
		cleanup: () => {
			runtime.clear();
			container?.remove();
		},
	};
}

test("design selection and capture carry the same complete registered pane identity", async () => {
	const f = await fixture();
	try {
		f.runtime.designs.toggle(f.id);
		await drain();
		expect(f.sets).toEqual([{ pane: f.pane, enabled: true }]);
		expect(f.awaits[0].pane).toEqual(f.pane);
		const selected = payload();
		f.selection.resolve({
			kind: "selected",
			opId: f.awaits[0].opId,
			payload: selected,
		});
		await drain();
		await drain();
		expect(f.captures).toEqual([
			{ pane: f.pane, rect: selected.target.rectViewport },
		]);
		expect(f.runtime.designs.getState(f.id)).toEqual({
			phase: "confirming",
			payload: selected,
		});
	} finally {
		f.cleanup();
	}
});

test("design feedback uses the workspace URL instead of the desktop's SSH forwarding port", async () => {
	const f = await fixture();
	try {
		f.emit({
			...f.pane,
			type: "navigation-map",
			url: "http://localhost:3000/owned",
			guestUrl: "http://127.0.0.1:40555/owned",
		});
		f.runtime.designs.toggle(f.id);
		await drain();
		const selected = payload();
		selected.page.sanitizedUrl =
			"http://127.0.0.1:40555/owned?view=grid#target";
		f.selection.resolve({
			kind: "selected",
			opId: f.awaits[0].opId,
			payload: selected,
		});
		await drain();
		await drain();
		expect(f.runtime.designs.getState(f.id).payload?.page.sanitizedUrl).toBe(
			"http://localhost:3000/owned?view=grid#target",
		);
		expect(selected.page.sanitizedUrl).toBe(
			"http://127.0.0.1:40555/owned?view=grid#target",
		);
	} finally {
		f.cleanup();
	}
});

test("destroying a pane disarms only its registration and ignores its late selection", async () => {
	const f = await fixture();
	try {
		f.runtime.designs.toggle(f.id);
		await drain();
		f.runtime.destroy(f.id);
		expect(f.sets.at(-1)).toEqual({ pane: f.pane, enabled: false });
		f.selection.resolve({
			kind: "selected",
			opId: f.awaits[0].opId,
			payload: payload(),
		});
		await drain();
		expect(f.captures).toEqual([]);
		expect(f.runtime.designs.getState(f.id).phase).toBe("idle");
	} finally {
		f.cleanup();
	}
});

test("guest reregistration invalidates an in-flight arm without awaiting against the replacement", async () => {
	const f = await fixture({ deferEnable: true });
	try {
		f.runtime.designs.toggle(f.id);
		Object.assign(f.guest, { getWebContentsId: () => 43 });
		f.guest.dispatchEvent(new Event("dom-ready"));
		await drain();
		const replacement = f.runtime.registration(f.id);
		expect(replacement?.registrationId).not.toBe(f.pane.registrationId);
		f.enable.resolve({ ok: true });
		await drain();
		expect(f.sets).toEqual([
			{ pane: f.pane, enabled: true },
			{ pane: f.pane, enabled: false },
		]);
		expect(f.awaits).toEqual([]);
		expect(f.runtime.designs.getState(f.id).phase).toBe("idle");
	} finally {
		f.cleanup();
	}
});

test("detaching the displayed pane cancels the picker before hiding its guest", async () => {
	const f = await fixture();
	try {
		f.runtime.designs.toggle(f.id);
		await drain();
		f.runtime.detach(f.id);
		expect(f.sets.at(-1)).toEqual({ pane: f.pane, enabled: false });
		expect(f.runtime.designs.getState(f.id).phase).toBe("idle");
	} finally {
		f.cleanup();
	}
});

test("full page loading discards a confirmation from the previous document", async () => {
	const f = await fixture();
	try {
		f.runtime.designs.toggle(f.id);
		await drain();
		f.selection.resolve({
			kind: "selected",
			opId: f.awaits[0].opId,
			payload: payload(),
		});
		await drain();
		await drain();
		expect(f.runtime.designs.getState(f.id).phase).toBe("confirming");
		f.guest.dispatchEvent(new Event("did-start-loading"));
		expect(f.runtime.designs.getState(f.id).phase).toBe("idle");
		expect(f.sets.at(-1)).toEqual({ pane: f.pane, enabled: false });
	} finally {
		f.cleanup();
	}
});
