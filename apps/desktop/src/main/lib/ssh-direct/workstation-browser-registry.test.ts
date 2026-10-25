import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { DirectDescriptor } from "../../../shared/direct-workstation";
import type {
	WorkstationBrowserEvent,
	WorkstationBrowserPane,
} from "../../../shared/workstation-browser";
import { WorkstationBrowserRegistry } from "./workstation-browser-registry";

const connectionId = "58f4aac1-412c-4fca-83c2-4bc9c2293dc4";
const secondConnectionId = "51ff8583-f9b1-4ea4-a19c-dd91d6d9695d";
const pane: WorkstationBrowserPane = {
	connectionId,
	generation: 1,
	workspaceId: "f340a634-2199-4305-86c4-03c46c046e1c",
	paneId: "page",
	registrationId: "2af9d874-b03f-44e2-a4dd-3215739613ea",
};

class Guest extends EventEmitter {
	destroyed = false;
	type = "webview";
	closeCalls = 0;
	hostWebContents = { id: 7, isDestroyed: () => false };
	constructor(readonly id: number) {
		super();
	}
	isDestroyed = () => this.destroyed;
	getType = () => this.type;
	close = () => {
		this.closeCalls++;
		this.destroyed = true;
		this.emit("destroyed");
	};
}

function fixture() {
	const descriptors = new Map<string, DirectDescriptor>(
		[connectionId, secondConnectionId].map((id) => [
			id,
			{
				connectionId: id,
				generation: 1,
				backendId: `backend-${id}`,
				namespaceId: "namespace",
				instanceId: "instance",
			},
		]),
	);
	const guests = new Map([10, 11, 12].map((id) => [id, new Guest(id)]));
	const manager = Object.assign(new EventEmitter(), {
		registered: new Map<string, { guest: number; workspaceId?: string }>(),
		active: [] as string[],
		register(key: string, guest: number, workspaceId?: string) {
			this.registered.set(key, { guest, workspaceId });
		},
		unregister(key: string) {
			this.registered.delete(key);
		},
		getAgentActivePaneIds() {
			return this.active;
		},
	});
	const events: { owner: number; event: WorkstationBrowserEvent }[] = [];
	const dependencies = {
		manager,
		getGuest: (id: number) => guests.get(id),
		describe: (id: string) => {
			const descriptor = descriptors.get(id);
			if (!descriptor) throw new Error("Disconnected");
			return descriptor;
		},
		checkWorkspace: async (_pane: WorkstationBrowserPane) => {},
		send: (owner: number, event: WorkstationBrowserEvent) =>
			events.push({ owner, event }),
	};
	const registry = new WorkstationBrowserRegistry(dependencies);
	registry.activateOwner(7);
	const guest = (id = 10) => {
		const value = guests.get(id);
		if (!value) throw new Error("Missing fixture guest");
		return value;
	};
	return {
		registry,
		dependencies,
		manager,
		descriptors,
		guests,
		guest,
		events,
	};
}

test("only the active window's live webview can register", async () => {
	const f = fixture();
	await expect(
		f.registry.register(8, { ...pane, webContentsId: 10 }),
	).rejects.toThrow("owner");
	const guest = f.guest();
	guest.hostWebContents.id = 8;
	await expect(
		f.registry.register(7, { ...pane, webContentsId: 10 }),
	).rejects.toThrow("belong");
	guest.hostWebContents.id = 7;
	guest.type = "window";
	await expect(
		f.registry.register(7, { ...pane, webContentsId: 10 }),
	).rejects.toThrow("belong");
	guest.type = "webview";
	guest.destroyed = true;
	await expect(
		f.registry.register(7, { ...pane, webContentsId: 10 }),
	).rejects.toThrow("belong");
	expect(f.manager.registered.size).toBe(0);
	f.registry.dispose();
});

test("equal pane IDs on different connections have independent manager events and lifetimes", async () => {
	const f = fixture();
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	await f.registry.register(7, {
		...pane,
		connectionId: secondConnectionId,
		webContentsId: 11,
	});
	const [firstKey, secondKey] = [...f.manager.registered.keys()];
	expect(firstKey).not.toBe(secondKey);
	f.events.length = 0;
	f.manager.emit(`new-window:${firstKey}`, "https://example.com/first");
	f.manager.emit(`new-window:${secondKey}`, "https://example.com/second");
	expect(f.events).toEqual([
		{
			owner: 7,
			event: { ...pane, type: "new-window", url: "https://example.com/first" },
		},
		{
			owner: 7,
			event: {
				...pane,
				connectionId: secondConnectionId,
				type: "new-window",
				url: "https://example.com/second",
			},
		},
	]);
	f.registry.closeConnection(connectionId);
	expect(f.guests.get(10)?.closeCalls).toBe(1);
	expect(f.guests.get(11)?.closeCalls).toBe(0);
	expect([...f.manager.registered.keys()]).toEqual([secondKey]);
	f.manager.emit(`new-window:${firstKey}`, "https://example.com/stale");
	expect(f.events).toHaveLength(2);
	f.registry.dispose();
	expect(f.manager.eventNames()).toEqual([]);
});

test("a guest cannot be adopted by another pane in the same window", async () => {
	const f = fixture();
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	await expect(
		f.registry.register(7, { ...pane, paneId: "other", webContentsId: 10 }),
	).rejects.toThrow("another pane");
	expect(f.manager.registered.size).toBe(1);
	f.registry.dispose();
});

test("workspace verification that returns after a same-ID window reload cannot register a page", async () => {
	const f = fixture();
	const verification = Promise.withResolvers<void>();
	f.dependencies.checkWorkspace = () => verification.promise;
	const pending = f.registry.register(7, { ...pane, webContentsId: 10 });
	f.registry.activateOwner(7);
	verification.resolve();
	await expect(pending).rejects.toThrow("cancelled");
	expect(f.manager.registered.size).toBe(0);
	f.registry.dispose();
});

test("an unregister sent before a same-ID window reload cannot remove the new page", async () => {
	const f = fixture();
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	f.registry.activateOwner(7);
	const verification = Promise.withResolvers<void>();
	f.dependencies.checkWorkspace = () => verification.promise;
	const newer = f.registry.register(7, {
		...pane,
		registrationId: "b6362538-a987-4c64-9c6f-6a6bb71f166b",
		webContentsId: 11,
	});
	f.registry.unregister(7, pane);
	verification.resolve();
	await newer;
	f.registry.unregister(7, pane);
	expect([...f.manager.registered.values()]).toEqual([
		{ guest: 11, workspaceId: pane.workspaceId },
	]);
	f.registry.dispose();
});

test("a superseded pending registration and its unregister cannot change the next generation", async () => {
	const f = fixture();
	const verification = Promise.withResolvers<void>();
	f.dependencies.checkWorkspace = () => verification.promise;
	const pending = f.registry.register(7, { ...pane, webContentsId: 10 });
	f.registry.closeConnection(connectionId);
	f.dependencies.describe(connectionId).generation = 2;
	f.dependencies.checkWorkspace = async () => {};
	await f.registry.register(7, { ...pane, generation: 2, webContentsId: 11 });
	verification.resolve();
	await expect(pending).rejects.toThrow("cancelled");
	f.registry.unregister(7, pane);
	expect([...f.manager.registered.values()]).toEqual([
		{ guest: 11, workspaceId: pane.workspaceId },
	]);
	f.registry.dispose();
});

test("an older workspace response cannot replace a newer guest for the same pane", async () => {
	const f = fixture();
	const first = Promise.withResolvers<void>();
	const second = Promise.withResolvers<void>();
	f.dependencies.checkWorkspace = () => first.promise;
	const older = f.registry.register(7, { ...pane, webContentsId: 10 });
	f.dependencies.checkWorkspace = () => second.promise;
	const newer = f.registry.register(7, { ...pane, webContentsId: 11 });
	second.resolve();
	await newer;
	first.resolve();
	await expect(older).rejects.toThrow("cancelled");
	expect([...f.manager.registered.values()]).toEqual([
		{ guest: 11, workspaceId: pane.workspaceId },
	]);
	expect(f.guest(10).closeCalls).toBe(0);
	f.registry.dispose();
});

test("changed namespace identity during verification rejects registration and stale events", async () => {
	const f = fixture();
	const verification = Promise.withResolvers<void>();
	f.dependencies.checkWorkspace = () => verification.promise;
	const pending = f.registry.register(7, { ...pane, webContentsId: 10 });
	f.dependencies.describe(connectionId).namespaceId = "changed";
	verification.resolve();
	await expect(pending).rejects.toThrow("identity");
	expect(f.manager.registered.size).toBe(0);
	f.dependencies.checkWorkspace = async () => {};
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	const [key] = [...f.manager.registered.keys()];
	f.events.length = 0;
	f.dependencies.describe(connectionId).instanceId = "replacement";
	f.manager.emit(`pane-focus:${key}`);
	if (!key) throw new Error("Missing fixture registration");
	f.manager.active = [key];
	f.manager.emit("agent-active");
	expect(f.events).toEqual([]);
	f.registry.dispose();
});

test("re-registration and guest destruction remove original manager and forwarding listeners", async () => {
	const f = fixture();
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	const [key] = [...f.manager.registered.keys()];
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	expect(f.manager.listenerCount(`new-window:${key}`)).toBe(1);
	f.guest().emit("destroyed");
	expect(f.manager.registered.size).toBe(0);
	expect(f.manager.listenerCount(`new-window:${key}`)).toBe(0);
	f.registry.dispose();
});

test("unregister cancels in-flight registration without adopting the guest", async () => {
	const f = fixture();
	const verification = Promise.withResolvers<void>();
	f.dependencies.checkWorkspace = () => verification.promise;
	const pending = f.registry.register(7, { ...pane, webContentsId: 10 });
	f.registry.unregister(7, pane);
	verification.resolve();
	await expect(pending).rejects.toThrow("cancelled");
	expect(f.manager.registered.size).toBe(0);
	expect(f.guests.get(10)?.closeCalls).toBe(0);
	f.registry.dispose();
});

test("connection cleanup releases every guest even when one original unregister fails", async () => {
	const f = fixture();
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	await f.registry.register(7, {
		...pane,
		paneId: "second",
		webContentsId: 11,
	});
	const unregister = f.manager.unregister.bind(f.manager);
	f.manager.unregister = (key) => {
		const guest = f.manager.registered.get(key)?.guest;
		unregister(key);
		if (guest === 10) throw new Error("Original unregister failed");
	};
	expect(() => f.registry.closeConnection(connectionId)).toThrow();
	expect(f.guest(10).closeCalls).toBe(1);
	expect(f.guest(11).closeCalls).toBe(1);
	expect(f.manager.registered.size).toBe(0);
	f.registry.dispose();
});

test("page metadata authorization requires the current owner, registration token and connection identity", async () => {
	const f = fixture();
	await f.registry.register(7, { ...pane, webContentsId: 10 });
	const owned = f.registry.getRegistration(7, pane);
	expect(owned?.namespaceId).toBe("namespace");
	if (!owned) throw new Error("Missing registration");
	owned.namespaceId = "changed-return-value";
	expect(f.registry.getRegistration(7, pane)?.namespaceId).toBe("namespace");
	expect(f.registry.getRegistration(8, pane)).toBeNull();
	expect(
		f.registry.getRegistration(7, {
			...pane,
			registrationId: "b6362538-a987-4c64-9c6f-6a6bb71f166b",
		}),
	).toBeNull();
	f.dependencies.describe(connectionId).instanceId = "replacement";
	expect(f.registry.getRegistration(7, pane)).toBeNull();
	f.registry.dispose();
});
