import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import { WorkstationBrowserNavigation } from "./workstation-browser-navigation";

function fixture(local = false) {
	const guest = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		loadURL: async (url: string) => {
			loads.push(url);
		},
	});
	const loads: string[] = [],
		prepared: number[] = [];
	const descriptor: DirectDescriptor = {
		connectionId: "connection",
		generation: 2,
		backendId: "backend",
		namespaceId: "namespace",
		instanceId: "instance",
	};
	const pane: WorkstationBrowserPane = {
		connectionId: "connection",
		generation: 2,
		workspaceId: "workspace",
		paneId: "pane",
		registrationId: "registration",
	};
	let current = true;
	let prepare = async (port: number) => {
		prepared.push(port);
		return { url: "http://127.0.0.1:48000" };
	};
	const events: unknown[] = [];
	const navigation = new WorkstationBrowserNavigation({
		isLocal: () => local,
		prepare: (_descriptor, _workspace, port) => prepare(port),
		send: (_owner, event) => events.push(event),
	});
	const detach = navigation.bind(1, pane, descriptor, guest, () => current);
	return {
		descriptor,
		navigation,
		pane,
		guest,
		loads,
		prepared,
		events,
		detach,
		invalidate: () => {
			current = false;
		},
		setPrepare: (next: typeof prepare) => {
			prepare = next;
		},
	};
}

test("SSH browser loopback navigation uses the scoped forward and preserves path/query/fragment", async () => {
	const f = fixture();
	await f.navigation.navigate(
		1,
		f.pane,
		"https://localhost:3000/中文?q=hello%20there#part",
	);
	expect(f.prepared).toEqual([3000]);
	expect(f.loads).toEqual([
		"https://127.0.0.1:48000/%E4%B8%AD%E6%96%87?q=hello%20there#part",
	]);
	expect(f.navigation.canonical(1, f.pane, f.loads[0]!)).toBe(
		"https://localhost:3000/%E4%B8%AD%E6%96%87?q=hello%20there#part",
	);
	expect(
		f.navigation.canonical(1, f.pane, "https://127.0.0.1:48000/icon.svg"),
	).toBe("https://localhost:3000/icon.svg");
	expect(
		f.navigation.canonical(
			1,
			f.pane,
			"https://example.com/中文?value='literal'",
		),
	).toBe("https://example.com/中文?value='literal'");
	f.detach();
});

test("local navigation stays local and an SSH guest redirect to loopback is intercepted", async () => {
	const local = fixture(true);
	await local.navigation.navigate(1, local.pane, "http://localhost:3000/path");
	expect(local.prepared).toEqual([]);
	expect(local.loads).toEqual(["http://localhost:3000/path"]);
	local.detach();
	const ssh = fixture();
	let prevented = false;
	ssh.guest.emit(
		"will-navigate",
		{
			preventDefault: () => {
				prevented = true;
			},
		},
		"http://localhost:3000/redirect",
	);
	expect(prevented).toBe(true);
	await Promise.resolve();
	await Promise.resolve();
	expect(ssh.loads).toEqual(["http://127.0.0.1:48000/redirect"]);
	ssh.detach();
});

test("a late forward cannot navigate a replaced registration or a changed connection", async () => {
	const f = fixture();
	const pending = Promise.withResolvers<{ url: string }>();
	f.setPrepare(() => pending.promise);
	const navigation = f.navigation.navigate(1, f.pane, "http://localhost:3000/");
	f.invalidate();
	pending.resolve({ url: "http://127.0.0.1:48000" });
	await expect(navigation).rejects.toThrow("changed");
	expect(f.loads).toEqual([]);
	await expect(
		f.navigation.navigate(2, f.pane, "https://example.com/"),
	).rejects.toThrow();
	f.detach();
});

test("a failed SSH forward never falls through to the desktop loopback address", async () => {
	const f = fixture();
	f.setPrepare(async () => {
		throw new Error("Owned forward unavailable");
	});
	await expect(
		f.navigation.navigate(1, f.pane, "http://localhost:3000/"),
	).rejects.toThrow("unavailable");
	expect(f.loads).toEqual([]);
	f.detach();
});

test("a newer navigation supersedes an unresolved forward without loading the old page", async () => {
	const f = fixture();
	const pending = Promise.withResolvers<{ url: string }>();
	f.setPrepare(() => pending.promise);
	const old = f.navigation.navigate(1, f.pane, "http://localhost:3000/old");
	await f.navigation.navigate(1, f.pane, "https://example.com/new");
	pending.resolve({ url: "http://127.0.0.1:48000" });
	expect(await old).toEqual({ status: "superseded" });
	expect(f.loads).toEqual(["https://example.com/new"]);
	f.detach();
});

test("navigation keeps the original about scheme and rejects non-browser protocols", async () => {
	const f = fixture(true);
	await f.navigation.navigate(1, f.pane, "about:blank#section");
	expect(f.loads).toEqual(["about:blank#section"]);
	for (const url of [
		"file:///etc/passwd",
		"javascript:alert(1)",
		"data:text/plain,owned",
	])
		await expect(f.navigation.navigate(1, f.pane, url)).rejects.toThrow(
			"not allowed",
		);
	f.detach();
});

test("icon reads require a current candidate and resolve SSH loopback resources in that workspace", async () => {
	const f = fixture();
	f.guest.emit("did-navigate", {}, "https://example.com/page");
	f.guest.emit("page-favicon-updated", {}, ["http://localhost:3000/icon.svg"]);
	expect(
		await f.navigation.resolveIcon(
			1,
			f.pane,
			"https://unrelated.invalid/icon.svg",
		),
	).toBeNull();
	expect(
		await f.navigation.resolveIcon(1, f.pane, "http://localhost:3000/icon.svg"),
	).toBe("http://127.0.0.1:48000/icon.svg");
	expect(f.prepared).toEqual([3000]);
	f.guest.emit("did-navigate", {}, "https://other.example/page");
	expect(
		await f.navigation.resolveIcon(1, f.pane, "http://localhost:3000/icon.svg"),
	).toBeNull();
	f.detach();
});

test("a late icon forward cannot cross a replaced registration even if its client token is reused", async () => {
	const f = fixture();
	const prepared = Promise.withResolvers<{ url: string }>();
	f.setPrepare(() => prepared.promise);
	f.guest.emit("did-navigate", {}, "https://example.com/page");
	f.guest.emit("page-favicon-updated", {}, ["http://localhost:3000/icon.svg"]);
	const pending = f.navigation.resolveIcon(
		1,
		f.pane,
		"http://localhost:3000/icon.svg",
	);
	f.detach();
	const detach = f.navigation.bind(
		1,
		f.pane,
		{ ...f.descriptor, instanceId: "replacement" },
		f.guest,
		() => true,
	);
	f.guest.emit("did-navigate", {}, "https://example.com/page");
	f.guest.emit("page-favicon-updated", {}, ["http://localhost:3000/icon.svg"]);
	prepared.resolve({ url: "http://127.0.0.1:48000" });
	expect(await pending).toBeNull();
	detach();
});
