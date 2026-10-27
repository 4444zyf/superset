import { expect, test } from "bun:test";
import type { WorkstationBrowserPane } from "../../../shared/workstation-browser";
import type { CdpSession } from "../browser/browser-manager";
import { WorkstationBrowserCdpSessions } from "./workstation-browser-cdp-sessions";
import type { BrowserReadTarget } from "./workstation-browser-read-channel";

function fixture() {
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
	const pane: WorkstationBrowserPane = {
		connectionId: "connection",
		generation: 1,
		workspaceId: "workspace",
		paneId: "pane",
		registrationId: "registration",
	};
	let current = true,
		destroyed = false,
		key = "owned-manager-key",
		guest = { isDestroyed: () => destroyed };
	let registry = {
		listRegistrations: (
			owner: number,
			descriptor: BrowserReadTarget["descriptor"],
			workspaceId?: string,
		) =>
			owner === 7 &&
			descriptor.backendId === "backend" &&
			workspaceId === pane.workspaceId
				? [{ ...pane }]
				: [],
		getManagerPaneId: (owner: number, input: unknown) =>
			owner === 7 &&
			(input as WorkstationBrowserPane).registrationId === pane.registrationId
				? key
				: null,
	};
	const attached: Array<{
		key: string;
		workspaceId: string;
		onMessage: (raw: string) => void;
		onDetach: (reason: string) => void;
		sent: string[];
		detaches: number;
	}> = [];
	let failure: Error | undefined,
		detachFailure: Error | undefined,
		duringAttach: ((c: (typeof attached)[number]) => void) | undefined;
	const sessions = new WorkstationBrowserCdpSessions({
		registry: () => registry,
		manager: {
			getWebContents: (id: string, workspaceId: string) =>
				id === key && workspaceId === pane.workspaceId ? guest : null,
			attachCdp: (
				id: string,
				workspaceId: string,
				onMessage: (raw: string) => void,
				onDetach: (reason: string) => void,
			): CdpSession => {
				if (failure) throw failure;
				const c = {
					key: id,
					workspaceId,
					onMessage,
					onDetach,
					sent: [] as string[],
					detaches: 0,
				};
				attached.push(c);
				duringAttach?.(c);
				return {
					send: (raw) => {
						c.sent.push(raw);
					},
					detach: () => {
						c.detaches++;
						if (detachFailure) throw detachFailure;
					},
				};
			},
		},
	});
	const messages: string[] = [],
		detached: string[] = [],
		pin = (workspaceId = "workspace", paneId = "pane") =>
			sessions.pin(target, { workspaceId, paneId }, () => current),
		open = () => {
			const pinned = pin();
			return {
				pinned,
				session: pinned.open({
					onMessage: (raw) => messages.push(raw),
					onDetach: (reason) => detached.push(reason),
				}),
			};
		};
	return {
		target,
		pane,
		pin,
		open,
		attached,
		attachedAt: (index = 0) => {
			const captured = attached[index];
			if (!captured) throw Error("Missing captured debugger session");
			return captured;
		},
		messages,
		detached,
		restore: () => {
			current = true;
		},
		retire: () => {
			current = false;
		},
		replaceRegistry: () => {
			registry = { ...registry };
		},
		replaceGuest: () => {
			guest = { ...guest };
		},
		replaceKey: () => {
			key = "replacement";
		},
		destroy: () => {
			destroyed = true;
		},
		failWith: (e: Error) => {
			failure = e;
		},
		failDetachWith: (e: Error) => {
			detachFailure = e;
		},
		duringAttach: (fn: typeof duringAttach) => {
			duringAttach = fn;
		},
	};
}
test("a pinned CDP session opens only the exact registered guest and forwards original raw frames", () => {
	const f = fixture(),
		p = f.pin();
	expect(f.attached).toEqual([]);
	f.target.descriptor.backendId = "mutated-after-pin";
	const s = p.open({
		onMessage: (r) => f.messages.push(r),
		onDetach: (r) => f.detached.push(r),
	});
	expect(f.attached).toHaveLength(1);
	expect(f.attached[0]).toMatchObject({
		key: "owned-manager-key",
		workspaceId: "workspace",
	});
	const raw =
		'{ "id": 1, "method": "Target.getTargets", "params": {"中文":"🙂"} }';
	s.send(raw);
	expect(f.attached[0]?.sent).toEqual([raw]);
	const event = '{ "method": "Runtime.consoleAPICalled", "params": {} }';
	f.attachedAt().onMessage(event);
	expect(f.messages).toEqual([event]);
	s.detach();
	p.release();
	expect(f.attached[0]?.detaches).toBe(1);
});
test("foreign workspace or pane cannot pin or attach the original CDP debugger", () => {
	const f = fixture();
	expect(() => f.pin("foreign")).toThrow();
	expect(() => f.pin("workspace", "foreign")).toThrow();
	expect(f.attached).toEqual([]);
});
test("retired owners, registries, registrations and actual guests are refused before debugger attachment", () => {
	for (const action of [
		"retire",
		"replaceRegistry",
		"replaceKey",
		"replaceGuest",
		"destroy",
	] as const) {
		const f = fixture(),
			p = f.pin();
		f[action]();
		expect(() => p.open({ onMessage: () => {}, onDetach: () => {} })).toThrow();
		expect(f.attached).toEqual([]);
	}
});
test("release before open never attaches and each captured CDP pin opens only once", () => {
	const f = fixture(),
		p = f.pin();
	p.release();
	p.release();
	expect(() => p.open({ onMessage: () => {}, onDetach: () => {} })).toThrow();
	expect(f.attached).toEqual([]);
	const g = fixture(),
		a = g.open();
	expect(() =>
		a.pinned.open({ onMessage: () => {}, onDetach: () => {} }),
	).toThrow();
	expect(g.attached).toHaveLength(1);
	a.pinned.release();
	expect(g.attached[0]?.detaches).toBe(1);
});
test("stale inbound and outbound CDP frames close their captured session once without forwarding", () => {
	for (const direction of ["inbound", "outbound"]) {
		const f = fixture(),
			a = f.open(),
			c = f.attachedAt();
		f.retire();
		if (direction === "inbound")
			a.session.send('{"id":1,"method":"Runtime.evaluate"}');
		else c.onMessage('{"id":1,"result":{}}');
		expect(c.sent).toEqual([]);
		expect(f.messages).toEqual([]);
		expect(c.detaches).toBe(1);
		expect(f.detached).toHaveLength(1);
		a.pinned.release();
		a.session.detach();
		c.onMessage("late");
		expect(c.detaches).toBe(1);
		expect(f.detached).toHaveLength(1);
	}
});
test("the original debugger busy error is preserved and does not detach another client", () => {
	const f = fixture(),
		busy = new Error("original debugger busy");
	f.failWith(busy);
	const p = f.pin();
	expect(() => p.open({ onMessage: () => {}, onDetach: () => {} })).toThrow(
		busy,
	);
	p.release();
	expect(f.attached).toEqual([]);
});
test("native detach closes once and a later old release cannot detach a new debugger session", () => {
	const f = fixture(),
		old = f.open(),
		c = f.attachedAt();
	c.onDetach("target closed");
	expect(f.detached).toEqual(["target closed"]);
	const fresh = f.open();
	old.pinned.release();
	old.session.detach();
	old.session.send("late old command");
	c.onMessage("late old event");
	expect(c.detaches).toBe(0);
	expect(c.sent).toEqual([]);
	expect(f.messages).toEqual([]);
	expect(f.attached[1]?.detaches).toBe(0);
	fresh.session.send("fresh");
	expect(f.attached[1]?.sent).toEqual(["fresh"]);
	fresh.pinned.release();
	expect(f.attached[1]?.detaches).toBe(1);
});
test("retirement during synchronous attachment releases the returned original handle and withholds events", () => {
	const f = fixture();
	f.duringAttach((c) => {
		f.retire();
		c.onMessage("stale during attach");
	});
	const p = f.pin();
	expect(() =>
		p.open({
			onMessage: (r) => f.messages.push(r),
			onDetach: (r) => f.detached.push(r),
		}),
	).toThrow();
	expect(f.messages).toEqual([]);
	expect(f.attached[0]?.detaches).toBe(1);
	p.release();
	expect(f.attached[0]?.detaches).toBe(1);
});
test("native detach during synchronous attachment does not detach that old handle again", () => {
	const f = fixture();
	f.duringAttach((c) => c.onDetach("already detached"));
	const p = f.pin();
	expect(() =>
		p.open({ onMessage: () => {}, onDetach: (r) => f.detached.push(r) }),
	).toThrow();
	p.release();
	expect(f.attached[0]?.detaches).toBe(0);
	expect(f.detached).toEqual(["already detached"]);
});
test("a failed outgoing event callback releases the captured debugger without escaping into main", () => {
	const f = fixture(),
		p = f.pin();
	p.open({
		onMessage: () => {
			throw Error("socket closed");
		},
		onDetach: () => {
			throw Error("socket already closed");
		},
	});
	f.failDetachWith(Error("guest teardown failed"));
	expect(() => f.attachedAt().onMessage("event")).not.toThrow();
	expect(f.attached[0]?.detaches).toBe(1);
	p.release();
	expect(f.attached[0]?.detaches).toBe(1);
});

test("a refused stale open attempt cannot revive the captured pin when availability returns", () => {
	const f = fixture(),
		p = f.pin();
	f.retire();
	expect(() => p.open({ onMessage: () => {}, onDetach: () => {} })).toThrow();
	f.restore();
	expect(() => p.open({ onMessage: () => {}, onDetach: () => {} })).toThrow();
	expect(f.attached).toEqual([]);
});
