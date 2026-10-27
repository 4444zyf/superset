import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cookie, Session } from "electron";
import {
	type ImportedCookie,
	importCookies,
	importCookiesIntoSession,
} from "./chrome-cookie-import";

const cookie = (name: string, path = "/"): ImportedCookie => ({
	url: "https://example.com" + path,
	name,
	value: "owned",
	path,
	secure: true,
	httpOnly: true,
	sameSite: "lax",
});
const stored = (domain: string, path: string): Cookie => ({
	domain,
	path,
	name: "sid",
	value: "owned",
	hostOnly: !domain.startsWith("."),
	secure: true,
	httpOnly: true,
	session: true,
	sameSite: "lax",
});
function fixture() {
	let current = true;
	const calls: { get: number; remove: unknown[][]; set: unknown[] } = {
		get: 0,
		remove: [],
		set: [],
	};
	let get = async (): Promise<Cookie[]> => [],
		remove = async (_url: string, _name: string) => {},
		set = async (_cookie: Electron.CookiesSetDetails) => {};
	const session = {
		cookies: {
			get: () => {
				calls.get++;
				return get();
			},
			remove: (url: string, name: string) => {
				calls.remove.push([url, name]);
				return remove(url, name);
			},
			set: (value: Electron.CookiesSetDetails) => {
				calls.set.push(value);
				return set(value);
			},
		},
	} as unknown as Session;
	return {
		session,
		calls,
		current: () => current,
		retire: () => {
			current = false;
		},
		get: (next: typeof get) => {
			get = next;
		},
		remove: (next: typeof remove) => {
			remove = next;
		},
		set: (next: typeof set) => {
			set = next;
		},
	};
}
test("an invalid import owner cannot read or change the target cookie jar", async () => {
	const f = fixture();
	f.retire();
	await expect(
		importCookies(f.session, [cookie("sid")], f.current),
	).rejects.toThrow("no longer current");
	expect(f.calls).toEqual({ get: 0, remove: [], set: [] });
});
test("a window changing during the jar read cannot remove or set cookies", async () => {
	const f = fixture(),
		jar = Promise.withResolvers<Cookie[]>();
	f.get(() => jar.promise);
	const result = importCookies(f.session, [cookie("sid")], f.current);
	f.retire();
	jar.resolve([stored(".example.com", "/")]);
	await expect(result).rejects.toThrow("no longer current");
	expect(f.calls.remove).toEqual([]);
	expect(f.calls.set).toEqual([]);
});
test("retirement after removing a dotted twin stops restoration and new cookie writes", async () => {
	const f = fixture();
	f.get(async () => [
		stored(".example.com", "/mail"),
		stored("example.com", "/"),
	]);
	f.remove(async () => {
		f.retire();
	});
	await expect(
		importCookies(f.session, [cookie("sid", "/mail")], f.current),
	).rejects.toThrow("no longer current");
	expect(f.calls.remove).toHaveLength(1);
	expect(f.calls.set).toEqual([]);
});
test("a failed collateral write cannot roll back through a retired owner", async () => {
	const f = fixture();
	f.get(async () => [
		stored(".example.com", "/mail"),
		stored("example.com", "/"),
	]);
	f.set(async () => {
		f.retire();
		throw Error("Owned collateral failure");
	});
	await expect(
		importCookies(f.session, [cookie("sid", "/mail")], f.current),
	).rejects.toThrow("no longer current");
	expect(f.calls.remove).toHaveLength(1);
	expect(f.calls.set).toHaveLength(1);
});
test("a window changing during the first accepted cookie write stops the remaining writes", async () => {
	const f = fixture();
	f.set(async () => {
		f.retire();
	});
	await expect(
		importCookies(f.session, [cookie("first"), cookie("second")], f.current),
	).rejects.toThrow("no longer current");
	expect(f.calls.set).toMatchObject([{ name: "first" }]);
});
test("the profile wrapper rechecks ownership after awaiting its original reader", async () => {
	const profile = mkdtempSync(join(tmpdir(), "owned-cookie-current-")),
		f = fixture();
	try {
		const result = importCookiesIntoSession(
			f.session,
			profile,
			"chrome",
			f.current,
		);
		f.retire();
		await expect(result).rejects.toThrow("no longer current");
		expect(f.calls).toEqual({ get: 0, remove: [], set: [] });
	} finally {
		rmSync(profile, { recursive: true, force: true });
	}
});
test("an active optional guard preserves original protected-host filtering and rejected-cookie counts", async () => {
	const original = fixture(),
		guarded = fixture();
	for (const f of [original, guarded])
		f.set(async (value) => {
			if (value.name === "bad") throw Error("Owned rejected cookie");
		});
	const input = [
		{ ...cookie("protected"), url: "https://app.superset.sh/" },
		cookie("bad"),
		cookie("good"),
	];
	const before = await importCookies(original.session, input),
		after = await importCookies(guarded.session, input, guarded.current);
	expect(after).toEqual({ imported: 1, skipped: 2 });
	expect(after).toEqual(before);
	expect(guarded.calls).toEqual(original.calls);
});
