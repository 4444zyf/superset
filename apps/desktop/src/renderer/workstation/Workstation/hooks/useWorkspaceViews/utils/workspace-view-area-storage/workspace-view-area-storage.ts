import type { DirectWorkstationApi } from "shared/direct-workstation";
import type { WorkspaceViewSnapshotV2 } from "shared/workspace-view-v2";
import {
	validateWorkspaceViewV3,
	type WorkspaceViewSnapshotV3,
} from "shared/workspace-view-v3";
import type { WorkstationBrowserOpenApi } from "shared/workstation-browser-open";
import { preserveBrowserOpenSelectionV3 } from "../../../../utils/workspace-browser-open/workspace-browser-open-selection-v3";

type Api = Pick<
	DirectWorkstationApi,
	"getWorkspaceViewV3" | "saveWorkspaceViewV3"
> & {
	browser?: { openRequests?: Pick<WorkstationBrowserOpenApi, "saveViewV3"> };
};
interface RefreshOptions {
	navigationRevision: number;
	isCurrent(): boolean;
	current(): WorkspaceViewSnapshotV3 | null;
	connectionId: string;
	workspaceId: string;
	show: boolean;
	preserveOtherTargets?: boolean;
}
type RefreshResult =
	| { status: "stale" }
	| {
			status: "ready";
			snapshot: WorkspaceViewSnapshotV3 | null;
			revision: number;
	  };
export function createWorkspaceViewAreaStorage(api: Api, enabled = false) {
	const reader = api.getWorkspaceViewV3,
		writer = api.saveWorkspaceViewV3;
	if (!enabled || !reader || !writer || !api.browser?.openRequests?.saveViewV3)
		return null;
	const read = () => reader.call(api);
	return {
		read,
		save: (input: Parameters<typeof writer>[0]) => writer.call(api, input),
		async refreshAfterLegacy(
			ack: WorkspaceViewSnapshotV2,
			options: RefreshOptions,
		): Promise<RefreshResult> {
			if (!options.isCurrent()) return { status: "stale" };
			const result = await read();
			if (
				!options.isCurrent() ||
				result.navigationRevision !== options.navigationRevision
			)
				return { status: "stale" };
			if (result.invalid) throw Error("Workspace view storage is unavailable");
			if (result.revision < ack.revision)
				throw Error("Workspace view refresh is older than its acknowledgement");
			const current = options.current();
			if (
				!options.isCurrent() ||
				(current && current.revision > result.revision)
			)
				return { status: "stale" };
			const snapshot = result.snapshot;
			if (!snapshot)
				return { status: "ready", snapshot: null, revision: result.revision };
			if (snapshot.schemaVersion !== 3 || snapshot.revision !== result.revision)
				throw Error("Workspace view snapshot revision changed");
			const { schemaVersion: _, revision, updatedAt, ...view } = snapshot;
			const valid: WorkspaceViewSnapshotV3 = {
				...validateWorkspaceViewV3(view),
				schemaVersion: 3,
				revision,
				updatedAt,
			};
			return {
				status: "ready",
				revision: result.revision,
				snapshot: preserveBrowserOpenSelectionV3(
					current,
					valid,
					options.connectionId,
					options.workspaceId,
					options.show,
					options.preserveOtherTargets,
				),
			};
		},
	};
}
