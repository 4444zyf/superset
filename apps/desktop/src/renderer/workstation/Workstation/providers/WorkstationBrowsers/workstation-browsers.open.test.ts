import { expect, test } from "bun:test";
import type { DirectWorkstationApi } from "shared/direct-workstation";
import { WorkstationBrowsers } from "./workstation-browsers";
function fixture(options: { precreate?: boolean; syncFailure?: boolean } = {}) {
	const started = Promise.withResolvers<void>(),
		registered = Promise.withResolvers<void>(),
		navigated = Promise.withResolvers<void>(),
		navigationStarted = Promise.withResolvers<void>();
	let navigations = 0;
	const runtime = new WorkstationBrowsers({
		browser: {
			register: () => {
				started.resolve();
				if (options.syncFailure)
					throw Error("Owned synchronous registration failure");
				return registered.promise;
			},
			unregister: async () => {},
			navigate: async () => {
				navigations++;
				navigationStarted.resolve();
				await navigated.promise;
				return { status: "navigated" };
			},
			onEvent: () => () => {},
		},
	} as unknown as DirectWorkstationApi);
	const workspaceId = crypto.randomUUID(),
		id = runtime.ensure(
			{
				connectionId: crypto.randomUUID(),
				backendId: "owned",
				namespaceId: "namespace",
				instanceId: "instance",
				generation: 1,
			},
			workspaceId,
			{
				kind: "browser",
				paneId: "browser",
				resourceId: crypto.randomUUID(),
				browser: {
					url: "http://localhost:3000/owned",
					pageTitle: "",
					faviconUrl: null,
				},
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
	let guest: Electron.WebviewTag | undefined,
		container: HTMLElement | null = null;
	if (options.precreate !== false) {
		guest = runtime.core.openBackground(
			id,
			"about:blank",
			workspaceId,
			() => {},
		).webview;
		container = guest.parentElement;
	}
	let configuredGuest: Electron.WebviewTag | undefined;
	const prepareGuest = () => {
		if (!guest) {
			guest = [...document.querySelectorAll("webview")].at(-1) as
				| Electron.WebviewTag
				| undefined;
			container = guest?.parentElement ?? null;
		}
		if (!guest) throw Error("Missing parked guest");
		if (configuredGuest !== guest) {
			Object.assign(guest, {
				getWebContentsId: () => 42,
				executeJavaScript: async () => {
					throw Error("No viewport stream in owned fixture");
				},
			});
			configuredGuest = guest;
		}
		return guest;
	};

	return {
		runtime,
		id,
		get guest() {
			return prepareGuest();
		},
		started,
		registered,
		navigated,
		navigationStarted,
		navigations: () => navigations,
		close() {
			registered.resolve();
			navigated.resolve();
			runtime.clear();
			container?.remove();
		},
	};
}
test("background acknowledgement waits for main registration and reuses the original parked guest", async () => {
	const f = fixture();
	try {
		let settled = false;
		const pending = f.runtime.openBackground(f.id).then((value) => {
			settled = true;
			return value;
		});
		f.guest.dispatchEvent(new Event("dom-ready"));
		await f.started.promise;
		expect(f.runtime.registration(f.id)).not.toBeNull();
		expect(settled).toBe(false);
		expect(f.navigations()).toBe(0);
		f.registered.resolve();
		const pane = await pending;
		const registration = f.runtime.registration(f.id);
		if (!registration) throw Error("Missing completed registration");
		expect(pane).toEqual(registration);
		expect(pane.paneId).toBe("browser");
		await f.navigationStarted.promise;
		expect(f.navigations()).toBe(1);
		expect(f.guest.style.width).toBe("1280px");
		expect(f.guest.style.visibility).toBe("hidden");
		expect(await f.runtime.openBackground(f.id)).toEqual(pane);
	} finally {
		f.close();
	}
});
test("aborting a background waiter before registration rejects without focusing or destroying its parked guest", async () => {
	const f = fixture(),
		abort = new AbortController();
	try {
		const pending = f.runtime
			.openBackground(f.id, abort.signal)
			.catch((error) => error);
		abort.abort();
		expect((await pending).message).toContain("cancelled");
		expect(f.guest.isConnected).toBe(true);
		expect(f.runtime.registration(f.id)).toBeNull();
	} finally {
		f.close();
	}
});
test("a removed background runtime rejects its waiter instead of accepting a late registration", async () => {
	const f = fixture();
	try {
		const pending = f.runtime.openBackground(f.id).catch((error) => error);
		f.guest.dispatchEvent(new Event("dom-ready"));
		await f.started.promise;
		f.runtime.destroy(f.id);
		expect((await pending).message).toContain("removed");
		f.registered.resolve();
		expect(f.runtime.registration(f.id)).toBeNull();
		expect(f.navigations()).toBe(0);
	} finally {
		f.close();
	}
});

test("a background request creates an original parked guest before its workspace has mounted", async () => {
	const f = fixture({ precreate: false });
	try {
		const before = document.querySelectorAll("webview").length;
		const pending = f.runtime.openBackground(f.id);
		expect(document.querySelectorAll("webview").length).toBe(before + 1);
		f.guest.dispatchEvent(new Event("dom-ready"));
		await f.started.promise;
		f.registered.resolve();
		expect((await pending).paneId).toBe("browser");
		expect(f.guest.style.visibility).toBe("hidden");
	} finally {
		f.close();
	}
});
test("a main registration failure rejects all waiters and cannot be mistaken for readiness", async () => {
	const f = fixture();
	try {
		const one = f.runtime.openBackground(f.id).catch((error) => error),
			two = f.runtime.openBackground(f.id).catch((error) => error);
		f.guest.dispatchEvent(new Event("dom-ready"));
		await f.started.promise;
		f.registered.reject(new Error("Owned main registration failure"));
		expect((await one).message).toBe("Owned main registration failure");
		expect((await two).message).toBe("Owned main registration failure");
		expect(
			(await f.runtime.openBackground(f.id).catch((error) => error)).message,
		).toBe("Owned main registration failure");
		expect(f.navigations()).toBe(0);
	} finally {
		f.close();
	}
});
test("a synchronous registration failure rejects the background request", async () => {
	const f = fixture({ syncFailure: true });
	try {
		const pending = f.runtime.openBackground(f.id).catch((error) => error);
		f.guest.dispatchEvent(new Event("dom-ready"));
		expect((await pending).message).toBe(
			"Owned synchronous registration failure",
		);
		expect(f.navigations()).toBe(0);
	} finally {
		f.close();
	}
});

test("cancelling one registration waiter preserves the other current waiter", async () => {
	const f = fixture(),
		abort = new AbortController();
	try {
		const one = f.runtime
				.openBackground(f.id, abort.signal)
				.catch((error) => error),
			two = f.runtime.openBackground(f.id);
		f.guest.dispatchEvent(new Event("dom-ready"));
		await f.started.promise;
		abort.abort();
		expect((await one).message).toContain("cancelled");
		f.registered.resolve();
		expect((await two).paneId).toBe("browser");
	} finally {
		f.close();
	}
});
test("a replaced guest registration cannot resolve the previous background request", async () => {
	const f = fixture();
	try {
		const old = f.runtime.openBackground(f.id).catch((error) => error);
		f.guest.dispatchEvent(new Event("dom-ready"));
		await f.started.promise;
		const first = f.runtime.registration(f.id);
		Object.assign(f.guest, { getWebContentsId: () => 43 });
		f.guest.dispatchEvent(new Event("dom-ready"));
		const replacement = f.runtime.registration(f.id);
		expect(replacement?.registrationId === first?.registrationId).toBe(false);
		expect((await old).message).toContain("registration changed");
		const next = f.runtime.openBackground(f.id);
		f.registered.resolve();
		expect((await next).registrationId).not.toBe(first?.registrationId);
		await f.navigationStarted.promise;
		expect(f.navigations()).toBe(1);
	} finally {
		f.close();
	}
});
