import { expect, test } from "bun:test";
import type { Session } from "electron";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import { WorkstationBrowserCookieImports } from "./workstation-browser-cookie-imports";
import type { BrowserReadTarget } from "./workstation-browser-read-channel";

function fixture(sharedSession = true) {
	const target: BrowserReadTarget = {
		ownerId: 7,
		ownerEpoch: 1,
		descriptor: {
			connectionId: "connection",
			generation: 1,
			backendId: "backend",
			namespaceId: "namespace",
			instanceId: "instance",
		},
	};
	const firstSession = {} as Session,
		secondSession = sharedSession ? firstSession : ({} as Session);
	let active = true,
		key = "manager-one",
		destroyed = false;
	let first = { session: firstSession, isDestroyed: () => destroyed };
	const second = { session: secondSession, isDestroyed: () => false };
	const pane: WorkstationBrowserPane = {
		connectionId: "connection",
		generation: 1,
		workspaceId: "owned",
		paneId: "page",
		registrationId: "registration-one",
	};
	const other: WorkstationBrowserPane = {
		...pane,
		paneId: "other-page",
		registrationId: "registration-two",
	};
	let registry = {
		listRegistrations: (
			owner: number,
			descriptor: BrowserReadTarget["descriptor"],
			workspace?: string,
		) =>
			owner === 7 && descriptor.backendId === "backend" && workspace === "owned"
				? [{ ...pane }, { ...other }]
				: [],
		getManagerPaneId: (owner: number, input: unknown) => {
			const p = input as WorkstationBrowserPane;
			return owner === 7 && p.registrationId === pane.registrationId
				? key
				: owner === 7 && p.registrationId === other.registrationId
					? "manager-two"
					: null;
		},
	};
	const source = { profileDir: "/owned/配置/Default", browserKey: "chrome" },
		calls: Array<{
			session: Session;
			profileDir: string;
			browserKey: string;
			current: () => boolean;
		}> = [],
		done = Promise.withResolvers<{
			imported: number;
			skipped: number;
			keyUnavailable: boolean;
		}>();
	const imports = new WorkstationBrowserCookieImports({
		registry: () => registry,
		manager: {
			getWebContents: (id: string) =>
				id === key ? first : id === "manager-two" ? second : null,
		},
		resolveProfile: (id: string) =>
			id === "/owned/配置/Default" ? source : null,
		importCookies: async (session, profileDir, browserKey, current) => {
			calls.push({ session, profileDir, browserKey, current });
			return done.promise;
		},
	});
	const pin = (paneId = "page", sourceId = "/owned/配置/Default") =>
		imports.pin(
			target,
			{ workspaceId: "owned", paneId, sourceId },
			() => active,
		);
	return {
		imports,
		pin,
		calls,
		done,
		firstSession,
		secondSession,
		retire: () => {
			active = false;
		},
		replaceKey: () => {
			key = "replaced-manager";
		},
		replaceGuest: () => {
			first = { ...first };
		},
		replaceSession: () => {
			first.session = {} as Session;
		},
		destroy: () => {
			destroyed = true;
		},
		replaceRegistry: () => {
			registry = { ...registry };
		},
		changeSourceObject: () => {
			source.profileDir = "/foreign";
			source.browserKey = "foreign";
		},
	};
}
const result = { imported: 2, skipped: 1, keyUnavailable: false };
test("cookie import captures the real registered guest session and current profile without dispatching at pin time", async () => {
	const f = fixture(),
		execute = f.pin();
	expect(f.calls).toEqual([]);
	f.changeSourceObject();
	const pending = execute();
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]).toMatchObject({
		session: f.firstSession,
		profileDir: "/owned/配置/Default",
		browserKey: "chrome",
	});
	expect(f.calls[0]?.current()).toBe(true);
	f.done.resolve(result);
	expect(await pending).toEqual(result);
	await expect(execute()).rejects.toThrow("already dispatched");
	execute.release?.();
});
test("a captured cookie import cannot execute through a retired owner, registry, registration, guest or session", async () => {
	for (const action of [
		"retire",
		"replaceKey",
		"replaceGuest",
		"replaceSession",
		"destroy",
		"replaceRegistry",
	] as const) {
		const f = fixture(),
			execute = f.pin();
		f[action]();
		await expect(execute()).rejects.toThrow();
		expect(f.calls).toEqual([]);
		execute.release?.();
	}
});
test("unlisted source paths cannot reach the importer", () => {
	const f = fixture();
	expect(() => f.pin("page", "OWNED-FOREIGN-PROFILE")).toThrow("source");
	expect(f.calls).toEqual([]);
	expect(() => f.pin("missing")).toThrow("pane");
});
test("different pages cannot reserve simultaneous imports into the same original browser session", () => {
	const f = fixture(),
		first = f.pin();
	expect(() => f.pin("other-page")).toThrow("pending");
	expect(f.calls).toEqual([]);
	first.release?.();
	const next = f.pin("other-page");
	next.release?.();
});
test("cancelling an active import fences its writes but keeps the session reserved until the original reader settles", async () => {
	const f = fixture(),
		first = f.pin(),
		pending = first().catch((e) => e);
	expect(f.calls[0]?.current()).toBe(true);
	first.release?.();
	expect(f.calls[0]?.current()).toBe(false);
	expect(() => f.pin("other-page")).toThrow("pending");
	f.done.resolve(result);
	expect(await pending).toBeInstanceOf(Error);
	const next = f.pin("other-page");
	next.release?.();
});
test("explicit cookie-data invalidation cancels pending import writes and does not release their active read early", async () => {
	const f = fixture(),
		first = f.pin(),
		pending = first().catch((e) => e);
	f.imports.invalidate();
	expect(f.calls[0]?.current()).toBe(false);
	expect(() => f.pin("other-page")).toThrow("pending");
	f.done.resolve(result);
	expect(await pending).toBeInstanceOf(Error);
	first.release?.();
	const next = f.pin("other-page");
	next.release?.();
});
test("independent actual browser sessions can import without blocking one another", async () => {
	const f = fixture(false),
		first = f.pin(),
		second = f.pin("other-page"),
		one = first(),
		two = second();
	expect(f.calls.map((c) => c.session)).toEqual([
		f.firstSession,
		f.secondSession,
	]);
	f.done.resolve(result);
	expect(await Promise.all([one, two])).toEqual([result, result]);
	first.release?.();
	second.release?.();
});
test("an old release cannot free a newer reservation for the same session", async () => {
	const f = fixture(),
		first = f.pin(),
		pending = first();
	f.done.resolve(result);
	await pending;
	const second = f.pin("other-page");
	first.release?.();
	expect(() => f.pin()).toThrow("pending");
	second.release?.();
});
test("the original key-unavailable result remains a completed result on the current target", async () => {
	const f = fixture(),
		execute = f.pin(),
		pending = execute(),
		unavailable = { imported: 0, skipped: 0, keyUnavailable: true };
	f.done.resolve(unavailable);
	expect(await pending).toEqual(unavailable);
	execute.release?.();
});
