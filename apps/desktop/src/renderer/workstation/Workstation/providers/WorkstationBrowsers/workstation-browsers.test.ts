import { expect, test } from "bun:test";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "shared/direct-workstation";
import type { WorkstationBrowserApi } from "shared/workstation-browser";
import { WorkstationBrowsers } from "./workstation-browsers";

test("device writes carry the registered pane and a superseded failure cannot overwrite the latest closed state", async () => {
	const old = Promise.withResolvers<{ status: "requested" }>();
	const ready = Promise.withResolvers<void>();
	const calls: Parameters<
		NonNullable<WorkstationBrowserApi["setDeviceEmulation"]>
	>[0][] = [];
	const errors: unknown[] = [];
	const descriptor: DirectDescriptor = {
		connectionId: crypto.randomUUID(),
		generation: 2,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	};
	const workspaceId = crypto.randomUUID();
	const api = {
		browser: {
			register: async () => {},
			unregister: async () => {},
			navigate: async () => {
				ready.resolve();
				return { status: "navigated" };
			},
			onEvent: () => () => {},
			setDeviceEmulation: async (input: (typeof calls)[number]) => {
				calls.push(input);
				if (calls.length === 1) return old.promise;
				if (calls.length === 3) throw Error("Owned current emulation failed");
				return { status: "requested" };
			},
		},
	} as unknown as DirectWorkstationApi;
	const runtime = new WorkstationBrowsers(api);
	const id = runtime.ensure(
		descriptor,
		workspaceId,
		{
			kind: "browser",
			paneId: "page",
			resourceId: crypto.randomUUID(),
			browser: { url: "about:blank", pageTitle: "", faviconUrl: null },
		},
		{
			onPersist() {},
			onClose() {},
			onFocus() {},
			onNewWindow() {},
			onFind() {},
			onError: (error) => errors.push(error),
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
			throw Error("Owned test guest has no viewport stream");
		},
	});
	try {
		guest.dispatchEvent(new Event("dom-ready"));
		await ready.promise;
		runtime.devices.toggle(id);
		runtime.devices.close(id);
		const registration = runtime.registration(id);
		if (!registration) throw Error("Owned guest did not register");
		expect(calls[0]).toEqual({
			pane: registration,
			params: { width: 375, height: 667 },
		});
		expect(calls[0].pane.connectionId).toBe(descriptor.connectionId);
		expect(calls[0].pane.workspaceId).toBe(workspaceId);
		old.reject(Error("Owned superseded emulation failed"));
		await Promise.resolve();
		await Promise.resolve();
		expect(errors).toEqual([]);
		expect(runtime.devices.getState(id).isOpen).toBe(false);
		runtime.devices.toggle(id);
		await Promise.resolve();
		await Promise.resolve();
		expect(errors.map((error) => String(error))).toEqual([
			"Error: Owned current emulation failed",
		]);
	} finally {
		runtime.clear();
		container?.remove();
	}
});
