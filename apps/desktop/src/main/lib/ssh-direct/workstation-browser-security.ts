import type { EventEmitter } from "node:events";
import { isAllowedGuestUrl } from "../browser/browser-manager";

export function configureWorkstationWebview(
	event: { preventDefault(): void },
	preferences: Electron.WebPreferences,
	params: { src: string; partition?: string },
): void {
	delete preferences.preload;
	Reflect.deleteProperty(preferences, "preloadURL");
	Object.assign(preferences, {
		nodeIntegration: false,
		nodeIntegrationInWorker: false,
		nodeIntegrationInSubFrames: false,
		contextIsolation: true,
		sandbox: true,
		webSecurity: true,
		allowRunningInsecureContent: false,
		webviewTag: false,
		plugins: false,
		partition: "persist:superset",
	});
	if (params.partition !== "persist:superset" || !isAllowedGuestUrl(params.src))
		event.preventDefault();
}

export function guardWorkstationWebviews(host: EventEmitter): void {
	host.on("will-attach-webview", configureWorkstationWebview);
	host.on("did-attach-webview", (_event, guest: Electron.WebContents) => {
		guest.setWindowOpenHandler(() => ({ action: "deny" }));
		const guard = (event: Electron.Event, url: string) => {
			if (!isAllowedGuestUrl(url)) event.preventDefault();
		};
		guest.on("will-navigate", guard);
		guest.on("will-redirect", guard);
		guest.once("destroyed", () => {
			guest.off("will-navigate", guard);
			guest.off("will-redirect", guard);
		});
	});
}
