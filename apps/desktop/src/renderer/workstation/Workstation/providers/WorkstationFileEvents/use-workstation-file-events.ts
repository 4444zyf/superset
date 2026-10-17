import { getEventBusForTransport } from "@superset/workspace-client/event-bus-core";
import type { FsWatchEvent } from "@superset/workspace-fs/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { WorkstationEventSocket } from "./workstation-event-socket";

function inside(root: string, value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 4096 &&
		!value.includes("\0") &&
		value.startsWith("/") &&
		!value.split("/").some((part) => part === "." || part === "..") &&
		(value === root ||
			value.startsWith(root === "/" ? "/" : `${root.replace(/\/$/, "")}/`))
	);
}
function validEvent(root: string, value: FsWatchEvent): boolean {
	return (
		value &&
		["create", "update", "delete", "rename", "overflow"].includes(value.kind) &&
		inside(root, value.absolutePath) &&
		(value.isDirectory === undefined ||
			typeof value.isDirectory === "boolean") &&
		(value.kind !== "rename" || inside(root, value.oldAbsolutePath))
	);
}
export function useWorkstationFileEvents({
	api,
	connection,
	workspaceId,
	root,
	paths,
	onEvents,
	onRefresh,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	root: string;
	paths: string[];
	onEvents(events: FsWatchEvent[]): void;
	onRefresh(): void;
}) {
	const key = JSON.stringify([
		"workstation",
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
	]);
	const enabled = connection.capabilities?.workstationFileEventsV1 === true;
	const bus = useMemo(
		() =>
			enabled && root
				? getEventBusForTransport(
						key,
						() => new WorkstationEventSocket(api, connection),
					)
				: null,
		[api, key, enabled, root, connection],
	);
	const callbacks = useRef({ onEvents, onRefresh });
	callbacks.current = { onEvents, onRefresh };
	const [status, setStatus] = useState<
		"open" | "connecting" | "reconnecting" | "closed" | null
	>(null);
	useEffect(() => {
		if (!bus) {
			setStatus(null);
			return;
		}
		let current = true;
		const release = bus.retain();
		const off = bus.on("fs:events", workspaceId, (_workspaceId, payload) => {
			if (!current || !Array.isArray(payload.events)) return;
			const events =
				payload.events.length > 4096
					? [{ kind: "overflow" as const, absolutePath: root }]
					: payload.events.filter((event) => validEvent(root, event));
			if (!events.length) return;
			callbacks.current.onEvents(events);
			callbacks.current.onRefresh();
		});
		const update = () => {
			if (!current) return;
			const state = bus.getConnectionStatus().state;
			setStatus(state);
			if (state === "open") {
				callbacks.current.onEvents([{ kind: "overflow", absolutePath: root }]);
				callbacks.current.onRefresh();
			}
		};
		const offStatus = bus.subscribeConnectionStatus(update);
		bus.watchFs(workspaceId);
		update();
		return () => {
			current = false;
			bus.unwatchFs(workspaceId);
			offStatus();
			off();
			release();
		};
	}, [bus, workspaceId, root]);
	const pathKey = JSON.stringify(
		[...new Set(paths)].filter((path) => inside(root, path)).sort(),
	);
	useEffect(() => {
		if (!bus) return;
		const files = JSON.parse(pathKey) as string[];
		for (const path of files) bus.watchFsFile(workspaceId, path);
		return () => {
			for (const path of files) bus.unwatchFsFile(workspaceId, path);
		};
	}, [bus, workspaceId, pathKey]);
	return { status, reconnect: () => bus?.reconnect() };
}
