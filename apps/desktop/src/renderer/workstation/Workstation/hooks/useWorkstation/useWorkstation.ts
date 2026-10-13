import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectSetupSnapshot } from "../../../../../shared/direct-workstation";
import type {
	DirectDescriptor,
	DirectLocalNamespace,
	DirectProfile,
	DirectWorkstationApi,
	MachineProbe,
	MachineSnapshot,
	RemoteDirectory,
	RemoteProject,
	RemoteWorkspace,
} from "../../types";

export function useWorkstation(api: DirectWorkstationApi) {
	const { t } = useLingui();
	const [setups, setSetups] = useState<Record<string, DirectSetupSnapshot>>({});
	useEffect(() => {
		let cancelled = false;
		const receive = (snapshot: DirectSetupSnapshot) => {
			if (cancelled) return;
			setSetups((previous) => {
				const old = previous[snapshot.connectionId];
				if (old && old.generation > snapshot.generation) return previous;
				if (old?.jobId === snapshot.jobId && old.sequence >= snapshot.sequence)
					return previous;
				return Object.fromEntries(
					Object.entries({
						...previous,
						[snapshot.connectionId]: snapshot,
					}).slice(-50),
				);
			});
		};
		const unsubscribe = api.onSetup?.(receive);
		if (api.getSetupSnapshot)
			void api
				.list()
				.then((profiles) =>
					Promise.all(
						profiles.slice(0, 50).map(async (profile) => {
							const snapshot = await api.getSetupSnapshot?.(profile.id);
							if (snapshot) receive(snapshot);
						}),
					),
				)
				.catch(() => {});
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [api]);
	const [snapshots, setSnapshots] = useState<Record<string, MachineSnapshot>>(
		{},
	);
	const [probes, setProbes] = useState<Record<string, MachineProbe>>({});
	const operationBusy = useRef(false);
	const [profiles, setProfiles] = useState<DirectProfile[]>([]);
	const [connection, setConnection] = useState<DirectDescriptor | null>(null);
	const [projects, setProjects] = useState<RemoteProject[]>([]);
	const [workspaces, setWorkspaces] = useState<RemoteWorkspace[]>([]);
	const [workspaceId, setWorkspaceId] = useState<string | null>(null);
	const [terminalIds, setTerminalIds] = useState<string[]>([]);
	const [terminalId, setTerminalId] = useState<string | null>(null);
	const [directory, setDirectory] = useState<RemoteDirectory | null>(null);
	const [busy, setBusy] = useState(false);
	const [reconnecting, setReconnecting] = useState<
		false | "reconnecting" | "blocked"
	>(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [forward, setForward] = useState<{ id: string; url: string } | null>(
		null,
	);
	const [pending, setPending] = useState<
		{ operationId: string; procedure: string; status: string }[]
	>([]);
	const procedureLabel = (procedure: string) =>
		(
			({
				"project.create": t({ message: "Create project" }),
				"workspaceCreation.createSession": t({ message: "New session" }),
				"workspaces.create": t({ message: "New session" }),
				"terminal.createSession": t({ message: "New terminal" }),
				"chat.createSession": t({ message: "New chat" }),
				"chat.prompt": t({ message: "Send message" }),
			}) as Record<string, string>
		)[procedure] ?? t({ message: "Action" });
	const statusLabel = (status: string) =>
		(
			({
				accepted: t({ message: "In progress" }),
				completed: t({ message: "Completed" }),
				failed: t({ message: "Failed" }),
				unresolved: t({ message: "Unresolved" }),
				not_received: t({ message: "Not sent" }),
			}) as Record<string, string>
		)[status] ?? t({ message: "Unknown" });
	const active = useRef<DirectDescriptor | null>(null);
	const localSelection = useRef<{
		profileId: string;
		backendId: string;
		namespaceId: string;
		epoch: number;
	} | null>(null);
	const selectedWorkspace = useRef<string | null>(null);
	const password = useRef<HTMLInputElement>(null);
	const operation = async <T>(
		execute: () => Promise<T>,
	): Promise<T | undefined> => {
		if (operationBusy.current) return;
		operationBusy.current = true;
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			return await execute();
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
			operationBusy.current = false;
		}
	};
	const rpc = useCallback(
		<T>(
			path: string,
			type: "query" | "mutation",
			input?: unknown,
			target = active.current,
		) => {
			if (!target)
				return Promise.reject(
					new Error(t({ message: "Connect to a machine first" })),
				);
			return api.rpc<T>({
				connectionId: target.connectionId,
				generation: target.generation,
				path,
				type,
				input,
			});
		},
		[api, t],
	);
	const refresh = useCallback(
		async (target = active.current, recheckFeatures = false) => {
			if (!target) return;
			const [nextProjects, nextWorkspaces] = await Promise.all([
				rpc<RemoteProject[]>("project.list", "query", undefined, target),
				rpc<RemoteWorkspace[]>("workspace.list", "query", undefined, target),
			]);
			if (
				active.current?.connectionId === target.connectionId &&
				active.current.generation === target.generation
			) {
				setProjects(nextProjects);
				setWorkspaces(nextWorkspaces);
				setSnapshots((previous) => ({
					...previous,
					[target.connectionId]: {
						projects: nextProjects,
						workspaces: nextWorkspaces,
						backendId: target.backendId,
						namespaceId: target.namespaceId,
						syncedAt: Date.now(),
					},
				}));
			}
			if (recheckFeatures) {
				const descriptor = await api.refreshFeatures(target);
				if (
					active.current?.connectionId === target.connectionId &&
					active.current.generation === target.generation
				) {
					active.current = descriptor;
					setConnection(descriptor);
				}
			}
		},
		[api, rpc],
	);
	const selectWorkspace = async (id: string) => {
		const target = active.current;
		selectedWorkspace.current = id;
		setWorkspaceId(id);
		setTerminalId(null);
		setTerminalIds([]);
		const { sessions } = await rpc<{ sessions: { terminalId: string }[] }>(
			"terminal.list",
			"query",
			{ workspaceId: id },
		);
		if (active.current !== target || selectedWorkspace.current !== id) return;
		setTerminalIds(sessions.map((session) => session.terminalId));
		setTerminalId(sessions[0]?.terminalId ?? null);
	};
	useEffect(() => {
		void api
			.list()
			.then(setProfiles)
			.catch((error) => setError(String(error)));
	}, [api]);
	useEffect(
		() =>
			api.onConnection?.((event) => {
				const current = active.current;
				if (
					!current ||
					current.connectionId !== event.connectionId ||
					current.generation !== event.previousGeneration
				)
					return;
				if (event.kind === "connected") {
					if (
						event.descriptor.backendId !== current.backendId ||
						event.descriptor.namespaceId !== current.namespaceId ||
						event.descriptor.generation <= current.generation
					)
						return;
					active.current = event.descriptor;
					setConnection(event.descriptor);
					setReconnecting(false);
					setError(null);
					setForward(null);
					void refresh(event.descriptor).catch((error) => {
						if (active.current === event.descriptor) setError(String(error));
					});
				} else {
					setReconnecting(event.kind);
					setForward(null);
					if (event.kind === "blocked") setError(event.error);
				}
			}),
		[api, refresh],
	);
	const namespaceSelected = (
		profileId: string,
		namespace: DirectLocalNamespace,
	) => {
		const previous = localSelection.current;
		const sameIdentity =
			previous?.profileId === profileId &&
			previous.backendId === namespace.backendId &&
			previous.namespaceId === namespace.namespaceId;
		localSelection.current = {
			profileId,
			backendId: namespace.backendId,
			namespaceId: namespace.namespaceId,
			epoch: previous ? previous.epoch + (sameIdentity ? 0 : 1) : 0,
		};
		if (!sameIdentity) {
			setSnapshots((previous) => {
				const next = { ...previous };
				delete next[profileId];
				return next;
			});
		}
		const current = active.current;
		if (
			!current ||
			current.connectionId !== profileId ||
			(current.namespaceId === namespace.namespaceId &&
				current.backendId === namespace.backendId)
		)
			return;
		active.current = null;
		selectedWorkspace.current = null;
		setConnection(null);
		setReconnecting(false);
		setWorkspaceId(null);
		setTerminalId(null);
		setTerminalIds([]);
		setProjects([]);
		setWorkspaces([]);
		setDirectory(null);
		setForward(null);
		setPending([]);
	};
	const connect = (profile: DirectProfile) =>
		operation(async () => {
			const selectionEpoch = localSelection.current?.epoch ?? 0;
			const selectionIsCurrent = () =>
				profile.kind !== "local" ||
				(localSelection.current?.epoch ?? 0) === selectionEpoch;
			const oneTimePassword = password.current?.value || undefined;
			if (password.current) password.current.value = "";
			if (active.current && active.current.connectionId !== profile.id)
				await api.disconnect(active.current.connectionId);
			if (!selectionIsCurrent()) return;
			active.current = null;
			setReconnecting(false);
			selectedWorkspace.current = null;
			setConnection(null);
			setWorkspaceId(null);
			setTerminalId(null);
			setTerminalIds([]);
			setDirectory(null);
			setProjects([]);
			setWorkspaces([]);
			setForward(null);
			setPending([]);
			let descriptor: DirectDescriptor;
			try {
				descriptor = await api.connect(profile.id, oneTimePassword);
			} catch (error) {
				if (!selectionIsCurrent()) return;
				throw error;
			}
			if (!selectionIsCurrent()) return;
			const selected = localSelection.current;
			if (
				profile.kind === "local" &&
				selected &&
				(selected.profileId !== descriptor.connectionId ||
					selected.backendId !== descriptor.backendId ||
					selected.namespaceId !== descriptor.namespaceId)
			)
				return;
			active.current = descriptor;
			setConnection(descriptor);
			await refresh(descriptor);
		});
	const disconnect = () =>
		operation(async () => {
			if (active.current) await api.disconnect(active.current.connectionId);
			active.current = null;
			setReconnecting(false);
			selectedWorkspace.current = null;
			setConnection(null);
			setWorkspaceId(null);
			setTerminalId(null);
			setTerminalIds([]);
			setDirectory(null);
			setProjects([]);
			setWorkspaces([]);
			setForward(null);
			setPending([]);
		});
	const control = (
		profile: DirectProfile,
		action: "install" | "activate" | "start" | "stop" | "repair" | "uninstall",
	) =>
		operation(async () => {
			const oneTimePassword = password.current?.value || undefined;
			if (password.current) password.current.value = "";
			const result = await api.control(profile.id, action, oneTimePassword);
			setNotice(t({ message: "Completed" }));
			if (
				result &&
				typeof result === "object" &&
				"status" in result &&
				result.status === "cancelled"
			) {
				setNotice(t({ message: "Cancelled" }));
				return;
			}
			if (action !== "install" && active.current?.connectionId === profile.id) {
				active.current = null;
				setReconnecting(false);
				selectedWorkspace.current = null;
				setConnection(null);
				setWorkspaceId(null);
				setTerminalId(null);
				setTerminalIds([]);
				setDirectory(null);
				setProjects([]);
				setWorkspaces([]);
				setForward(null);
				setPending([]);
			}
		});

	const saveProfile = (profile: DirectProfile) =>
		operation(async () => {
			const saved = await api.save(profile);
			if (active.current?.connectionId === profile.id) {
				active.current = null;
				setConnection(null);
				setWorkspaceId(null);
				setTerminalIds([]);
				setTerminalId(null);
				setProjects([]);
				setWorkspaces([]);
				setReconnecting(false);
				setDirectory(null);
				setPending([]);
				setForward(null);
			}
			setSnapshots((previous) => {
				const next = { ...previous };
				delete next[profile.id];
				return next;
			});
			setProfiles(await api.list());
			return saved;
		});
	const removeProfile = (profile: DirectProfile) =>
		operation(async () => {
			await api.remove(profile.id);
			if (active.current?.connectionId === profile.id) {
				active.current = null;
				setConnection(null);
				setWorkspaceId(null);
				setTerminalIds([]);
				setTerminalId(null);
				setProjects([]);
				setWorkspaces([]);
				setReconnecting(false);
				setDirectory(null);
				setPending([]);
				setForward(null);
			}
			setSnapshots((previous) => {
				const next = { ...previous };
				delete next[profile.id];
				return next;
			});
			setProfiles(await api.list());
			return true;
		});
	const testProfile = (profile: DirectProfile) =>
		operation(async () => {
			const result = await api.test(profile.id);
			if (
				result &&
				typeof result === "object" &&
				"platform" in result &&
				"architecture" in result
			) {
				const probe = result as MachineProbe;
				setProbes((previous) => ({
					...previous,
					[profile.id]: {
						platform: probe.platform,
						architecture: probe.architecture,
						installed: probe.installed === true,
					},
				}));
			}
			setNotice(t({ message: "SSH connection successful" }));
		});
	const importLocalData = (profile: DirectProfile) =>
		operation(async () => {
			const result = await api.importLocalData(profile.id);
			if (
				result &&
				typeof result === "object" &&
				"status" in result &&
				result.status === "cancelled"
			) {
				setNotice(t({ message: "Cancelled" }));
				return;
			}
			const warnings =
				result &&
				typeof result === "object" &&
				"warnings" in result &&
				Array.isArray(result.warnings)
					? result.warnings
							.filter((v): v is string => typeof v === "string")
							.slice(0, 10)
							.map((v) => v.slice(0, 512))
					: [];
			setNotice(
				[
					t({ message: "Local data imported. Start the backend to use it." }),
					...warnings,
				].join("\n\n"),
			);
		});
	const clearWorkspace = () => {
		selectedWorkspace.current = null;
		setWorkspaceId(null);
		setTerminalId(null);
		setTerminalIds([]);
	};
	return {
		clearWorkspace,
		profiles,
		connection,
		setups,
		projects,
		workspaces,
		workspaceId,
		terminalIds,
		terminalId,
		directory,
		busy,
		reconnecting,
		error,
		notice,
		forward,
		pending,
		active,
		password,
		snapshots,
		probes,
		procedureLabel,
		statusLabel,
		operation,
		rpc,
		refresh,
		selectWorkspace,
		connect,
		disconnect,
		control,
		namespaceSelected,
		saveProfile,
		removeProfile,
		testProfile,
		importLocalData,
		setDirectory,
		setError,
		setNotice,
		setPending,
		setTerminalId,
		setTerminalIds,
		setForward,
	};
}
