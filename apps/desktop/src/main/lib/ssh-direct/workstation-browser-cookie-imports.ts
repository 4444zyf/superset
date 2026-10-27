import type { Session, WebContents } from "electron";
import type { CookieImportResult } from "../browser/chrome-cookie-import";
import type { BrowserReadTarget } from "./workstation-browser-read-channel";
import type { WorkstationBrowserRegistry } from "./workstation-browser-registry";

type Failure = "unavailable" | "invalid" | "busy" | "failed";
export class WorkstationBrowserCookieImportError extends Error {
	constructor(
		readonly kind: Failure,
		message: string,
	) {
		super(message);
		this.name = "WorkstationBrowserCookieImportError";
	}
}
type Registry = Pick<
	WorkstationBrowserRegistry,
	"listRegistrations" | "getManagerPaneId"
>;
type Guest = Pick<WebContents, "session" | "isDestroyed">;
export class WorkstationBrowserCookieImports {
	private readonly sessions = new WeakMap<Session, object>();
	private epoch = {};
	constructor(
		private readonly dependencies: {
			registry(): Registry | null;
			manager: {
				getWebContents(key: string, workspaceId: string): Guest | null;
			};
			resolveProfile(
				sourceId: string,
			): { profileDir: string; browserKey: string } | null;
			importCookies(
				session: Session,
				profileDir: string,
				browserKey: string,
				current: () => boolean,
			): Promise<CookieImportResult>;
		},
	) {}
	invalidate(): void {
		this.epoch = {};
	}
	pin(
		target: BrowserReadTarget,
		request: { workspaceId: string; paneId: string; sourceId: string },
		isCurrent: () => boolean,
	): (() => Promise<CookieImportResult>) & { release(): void } {
		const unavailable = () =>
			new WorkstationBrowserCookieImportError(
				"unavailable",
				"Browser cookie import target is no longer current",
			);
		if (!isCurrent()) throw unavailable();
		const registry = this.dependencies.registry();
		if (!registry) throw unavailable();
		const descriptor = { ...target.descriptor },
			ownerId = target.ownerId;
		const registration = registry
			.listRegistrations(ownerId, descriptor, request.workspaceId)
			.find((p) => p.paneId === request.paneId);
		if (!registration)
			throw new WorkstationBrowserCookieImportError(
				"invalid",
				"Browser pane is no longer available",
			);
		const pane = { ...registration },
			key = registry.getManagerPaneId(ownerId, pane);
		if (!key) throw unavailable();
		const guest = this.dependencies.manager.getWebContents(
			key,
			pane.workspaceId,
		);
		if (!guest || guest.isDestroyed()) throw unavailable();
		const session = guest.session,
			profile = this.dependencies.resolveProfile(request.sourceId);
		if (!profile)
			throw new WorkstationBrowserCookieImportError(
				"invalid",
				"Browser login source is no longer available",
			);
		const capturedProfile = { ...profile },
			epoch = this.epoch;
		let started = false,
			released = false;
		const reservation = {};
		const scopeCurrent = () => {
			try {
				return (
					epoch === this.epoch &&
					isCurrent() &&
					this.dependencies.registry() === registry &&
					registry.getManagerPaneId(ownerId, pane) === key &&
					this.dependencies.manager.getWebContents(key, pane.workspaceId) ===
						guest &&
					!guest.isDestroyed() &&
					guest.session === session
				);
			} catch {
				return false;
			}
		};
		const current = () =>
			!released && scopeCurrent() && this.sessions.get(session) === reservation;
		if (!scopeCurrent()) throw unavailable();
		if (this.sessions.has(session))
			throw new WorkstationBrowserCookieImportError(
				"busy",
				"A browser cookie import is already pending for this session",
			);
		this.sessions.set(session, reservation);
		const finish = () => {
			if (this.sessions.get(session) === reservation)
				this.sessions.delete(session);
		};
		const execute = async () => {
			if (started)
				throw new WorkstationBrowserCookieImportError(
					"unavailable",
					"The pinned cookie import was already dispatched",
				);
			started = true;
			try {
				if (!current()) throw unavailable();
				const result = await this.dependencies.importCookies(
					session,
					capturedProfile.profileDir,
					capturedProfile.browserKey,
					current,
				);
				if (!current()) throw unavailable();
				return result;
			} catch (error) {
				if (!current()) throw unavailable();
				throw error;
			} finally {
				finish();
			}
		};
		execute.release = () => {
			released = true;
			if (!started) finish();
		};
		return execute;
	}
}
