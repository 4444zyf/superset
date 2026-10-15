import { Trans } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { ProjectScriptsEditor } from "renderer/components/ProjectScriptsEditor";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

type Snapshot = inferRouterOutputs<AppRouter>["config"]["getProjectScriptsV1"];

export function RemoteProjectScripts({
	api,
	connection,
	projectId,
	disabled,
	debounceMs,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	projectId: string;
	disabled?: boolean;
	debounceMs?: number;
}) {
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		projectId,
	]);
	const ownerRef = useRef(owner);
	ownerRef.current = owner;
	const mountedOwner = useRef<string | null>(null);
	const snapshot = useRef<Snapshot | null>(null);
	const [loaded, setLoaded] = useState<{
		owner: string;
		value: Snapshot;
	} | null>(null);
	const [busy, setBusy] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [blocked, setBlocked] = useState(false);
	const [epoch, setEpoch] = useState(0);
	const writing = useRef(false);
	const blockedRef = useRef(false);
	const capable = connection.capabilities?.workstationProjectScriptsV1 === true;
	const owned = () =>
		ownerRef.current === owner && mountedOwner.current === owner;
	const read = () =>
		api.rpc<Snapshot>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path: "config.getProjectScriptsV1",
			type: "query",
			input: { projectId },
		});
	const install = (value: Snapshot) => {
		snapshot.current = value;
		setLoaded({ owner, value });
	};
	useEffect(() => {
		mountedOwner.current = owner;
		snapshot.current = null;
		blockedRef.current = false;
		writing.current = false;
		setBlocked(false);
		setLoaded(null);
		setError(null);
		setBusy(true);
		setIsSaving(false);
		if (capable)
			void read()
				.then((value) => {
					if (owned()) install(value);
				})
				.catch((err) => {
					if (owned()) setError(errorMessage(err));
				})
				.finally(() => {
					if (owned()) setBusy(false);
				});
		else setBusy(false);
		return () => {
			if (mountedOwner.current === owner) mountedOwner.current = null;
		};
	}, [api, owner, capable]);
	const refresh = async () => {
		if (writing.current || !owned() || !capable) return;
		setBusy(true);
		writing.current = true;
		try {
			const actual = await read();
			if (!owned()) return;
			install(actual);
			setEpoch((v) => v + 1);
			setError(null);
			blockedRef.current = false;
			setBlocked(false);
		} catch (err) {
			if (owned()) setError(errorMessage(err));
		} finally {
			if (owned()) {
				writing.current = false;
				setBusy(false);
			}
		}
	};
	if (!capable) return null;
	return (
		<div data-remote-project-scripts>
			{error && (
				<p className="mb-3 text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
			<Button
				variant="outline"
				size="sm"
				className="mb-3"
				disabled={busy || isSaving || disabled}
				onClick={() => void refresh()}
			>
				<Trans>Refresh</Trans>
			</Button>
			{loaded?.owner === owner && (
				<ProjectScriptsEditor
					key={`${owner}:${epoch}`}
					content={loaded.value.content}
					disabled={disabled || blocked || busy}
					pauseOnError
					maxLength={128 * 1024}
					debounceMs={debounceMs}
					onSave={async (scripts) => {
						if (
							!owned() ||
							!snapshot.current ||
							writing.current ||
							blockedRef.current
						)
							throw new Error("Project script editor is unavailable");
						writing.current = true;
						setIsSaving(true);
						const request = {
							connectionId: connection.connectionId,
							generation: connection.generation,
							path: "config.setProjectScriptsV1",
							type: "mutation" as const,
							input: {
								projectId,
								expectedRevision: snapshot.current.revision,
								...scripts,
							},
						};
						try {
							const actual = await api.rpc<Snapshot>(request);
							if (!owned()) throw new Error("Project script editor changed");
							if (JSON.stringify(actual.scripts) !== JSON.stringify(scripts))
								throw new Error("Project scripts changed before confirmation");
							install(actual);
						} catch (err) {
							if (!owned()) throw err;
							let actual: Snapshot | null = null;
							try {
								actual = await read();
							} catch {}
							if (!owned()) throw err;
							if (
								actual &&
								JSON.stringify(actual.scripts) === JSON.stringify(scripts)
							) {
								install(actual);
								return;
							}
							blockedRef.current = true;
							setBlocked(true);
							setError(errorMessage(err));
							throw err;
						} finally {
							if (owned()) {
								writing.current = false;
								setIsSaving(false);
							}
						}
					}}
				/>
			)}
		</div>
	);
}
