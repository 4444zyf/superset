import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type {
	DirectDescriptor,
	DirectPort,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { RemoteWorkspacePorts } from "./RemoteWorkspacePorts";

afterEach(cleanup);
const connection: DirectDescriptor = {
	connectionId: "machine",
	backendId: "backend",
	namespaceId: "old",
	instanceId: "instance",
	generation: 1,
	capabilities: { workstationPortsV1: true },
};
const port = (number: number, workspaceId = "workspace"): DirectPort => ({
	port: number,
	pid: 123,
	processName: "node",
	workspaceId,
	terminalId: `terminal-${number}`,
	detectedAt: 1,
	address: "127.0.0.1",
	label: "Web",
});

test("discovered rows use the original external action and exclude other workspaces", async () => {
	const requests: unknown[] = [];
	const opened: number[] = [];
	const api = {
		listPorts: async (...args: unknown[]) => {
			requests.push(args);
			return [port(4000), port(3000), port(5000, "other")];
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspacePorts
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={(p) => opened.push(p)}
		/>,
	);
	await screen.findByText(":3000");
	expect(screen.queryByText(":5000")).toBeNull();
	expect(
		[...document.querySelectorAll("[data-workspace-ports] [data-port]")].map(
			(e) => e.getAttribute("data-port"),
		),
	).toEqual(["3000", "4000"]);
	expect(requests).toEqual([[connection, "workspace"]]);
	expect(screen.getByText(":3000").closest("button")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", {
			name: "Open localhost:3000 in external browser",
		}),
	);
	expect(opened).toEqual([3000]);
});

test.each([
	"resolve",
	"reject",
])("a late %s cannot replace another namespace's ports", async (kind) => {
	let finish!: (value: DirectPort[]) => void;
	let fail!: (error: Error) => void;
	const pending = new Promise<DirectPort[]>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	const requests: DirectDescriptor[] = [];
	const opened: number[] = [];
	const api = {
		listPorts: async (d: DirectDescriptor) => {
			requests.push(d);
			return d.namespaceId === "old" ? pending : [port(4000)];
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteWorkspacePorts
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={(p) => opened.push(p)}
		/>,
	);
	await waitFor(() => expect(requests).toHaveLength(1));
	view.rerender(
		<RemoteWorkspacePorts
			api={api}
			connection={{ ...connection, namespaceId: "new", generation: 2 }}
			workspaceId="workspace"
			busy={false}
			onOpenPort={(p) => opened.push(p)}
		/>,
	);
	await screen.findByText(":4000");
	await act(async () => {
		if (kind === "resolve") finish([port(3000)]);
		else fail(new Error("old namespace failure"));
	});
	expect(screen.queryByText(":3000")).toBeNull();
	expect(screen.queryByRole("alert")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", {
			name: "Open localhost:4000 in external browser",
		}),
	);
	expect(opened).toEqual([4000]);
});

test("old hosts and old desktop APIs do not start a discovery query", () => {
	const calls: unknown[] = [];
	const api = {
		listPorts: async () => {
			calls.push("query");
			return [];
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteWorkspacePorts
			api={api}
			connection={{ ...connection, capabilities: {} }}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	expect(view.container.textContent).toBe("");
	expect(calls).toEqual([]);
	view.rerender(
		<RemoteWorkspacePorts
			api={{} as DirectWorkstationApi}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	expect(view.container.textContent).toBe("");
	expect(calls).toEqual([]);
});

test("failed reads do not claim there are no ports and Refresh reads again", async () => {
	let failed = true;
	let calls = 0;
	const api = {
		listPorts: async () => {
			calls++;
			if (failed) throw new Error("offline");
			return [port(3000)];
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspacePorts
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	await screen.findByRole("alert");
	expect(screen.queryByText("No ports detected")).toBeNull();
	failed = false;
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText(":3000");
	expect(screen.queryByRole("alert")).toBeNull();
	expect(calls).toBe(2);
});

test("copy is explicit and forwards the discovered port to the workspace owner", async () => {
	const copied: number[] = [];
	const opened: number[] = [];
	const api = {
		listPorts: async () => [port(3000)],
		preparePort: async () => ({ id: "forward", url: "http://127.0.0.1:1000" }),
		copyText: async () => {},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspacePorts
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={(p) => opened.push(p)}
			onCopyPort={async (p) => {
				copied.push(p);
			}}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Copy localhost:3000" }),
	);
	expect(copied).toEqual([3000]);
	expect(opened).toEqual([]);
});

test("Close passes the exact workspace terminal and port, and ignores duplicate clicks", async () => {
	let finish!: (result: { success: boolean }) => void;
	const pending = new Promise<{ success: boolean }>((resolve) => {
		finish = resolve;
	});
	let running = true;
	const requests: unknown[] = [];
	const api = {
		listPorts: async () => (running ? [port(3000)] : []),
		killWorkspacePort: async (...args: unknown[]) => {
			requests.push(args);
			return pending;
		},
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspacePorts
			confirmClose={async () => true}
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	const button = await screen.findByRole("button", { name: "Close port 3000" });
	fireEvent.click(button);
	fireEvent.click(button);
	await waitFor(() =>
		expect(requests).toEqual([
			[connection, "workspace", "terminal-3000", 3000],
		]),
	);
	expect((button as HTMLButtonElement).disabled).toBe(true);
	running = false;
	await act(async () => finish({ success: true }));
	await waitFor(() => expect(screen.queryByText(":3000")).toBeNull());
});

test("a failed close keeps the row and shows the original backend failure", async () => {
	const api = {
		listPorts: async () => [port(3000)],
		killWorkspacePort: async () => ({
			success: false,
			error: "Port does not belong to the requested workspace",
		}),
	} as unknown as DirectWorkstationApi;
	render(
		<RemoteWorkspacePorts
			confirmClose={async () => true}
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Close port 3000" }),
	);
	await screen.findByRole("alert");
	expect(screen.getByText(":3000")).toBeTruthy();
	expect(screen.getByRole("alert").textContent).toContain("does not belong");
	expect(
		(
			screen.getByRole("button", {
				name: "Close port 3000",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
});

test("a late close failure cannot display in another namespace", async () => {
	let fail!: (e: Error) => void;
	const pending = new Promise<{ success: boolean }>((_, reject) => {
		fail = reject;
	});
	let started = false;
	const api = {
		listPorts: async (d: DirectDescriptor) => [
			port(d.namespaceId === "old" ? 3000 : 4000),
		],
		killWorkspacePort: async () => {
			started = true;
			return pending;
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteWorkspacePorts
			confirmClose={async () => true}
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Close port 3000" }),
	);
	await waitFor(() => expect(started).toBe(true));
	view.rerender(
		<RemoteWorkspacePorts
			confirmClose={async () => true}
			api={api}
			connection={{ ...connection, namespaceId: "new", generation: 2 }}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	await screen.findByText(":4000");
	await act(async () => fail(new Error("old failure")));
	expect(screen.queryByRole("alert")).toBeNull();
	expect(
		(
			screen.getByRole("button", {
				name: "Close port 4000",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
});

test.each([
	"cancelled",
	"scope changed",
])("a %s confirmation does not send a port kill", async (mode) => {
	let finish!: (value: boolean) => void;
	const confirmation = new Promise<boolean>((resolve) => {
		finish = resolve;
	});
	const requests: unknown[] = [];
	const api = {
		listPorts: async (d: DirectDescriptor) => [
			port(d.namespaceId === "old" ? 3000 : 4000),
		],
		killWorkspacePort: async (...args: unknown[]) => {
			requests.push(args);
			return { success: true };
		},
	} as unknown as DirectWorkstationApi;
	const view = render(
		<RemoteWorkspacePorts
			confirmClose={() => confirmation}
			api={api}
			connection={connection}
			workspaceId="workspace"
			busy={false}
			onOpenPort={() => {}}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Close port 3000" }),
	);
	if (mode === "scope changed") {
		view.rerender(
			<RemoteWorkspacePorts
				confirmClose={() => confirmation}
				api={api}
				connection={{ ...connection, namespaceId: "new", generation: 2 }}
				workspaceId="workspace"
				busy={false}
				onOpenPort={() => {}}
			/>,
		);
		await screen.findByText(":4000");
	}
	await act(async () => finish(mode !== "cancelled"));
	expect(requests).toEqual([]);
	expect(screen.queryByRole("alert")).toBeNull();
});
