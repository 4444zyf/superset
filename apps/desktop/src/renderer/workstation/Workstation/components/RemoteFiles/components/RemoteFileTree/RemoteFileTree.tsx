import { useLingui } from "@lingui/react/macro";
import { useFileTree } from "@pierre/trees/react";
import { FoldVertical } from "lucide-react";
import { useEffect, useRef } from "react";
import { buildPolicy } from "renderer/lib/clickPolicy/policies/buildPolicy";
import { usePierreRowClickPolicy } from "renderer/lib/clickPolicy/usePierreRowClickPolicy";
import { useFallthroughIcons } from "renderer/lib/fileIcons/useFallthroughIcons";
import { PIERRE_TREE_UNSAFE_CSS } from "renderer/lib/pierreTree";
import { FilesTabHeaderButton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/components/FilesTabHeaderButton/FilesTabHeaderButton";
import { FileTreeSurface } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/components/FileTreeSurface/FileTreeSurface";
import {
	FILE_EXPLORER_OVERSCAN,
	FILE_EXPLORER_ROW_HEIGHT,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/constants";
import { DEFAULT_V2_USER_PREFERENCES } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import {
	FileTreeController,
	type RemoteTreeEntry,
} from "./file-tree-controller";

export function RemoteFileTree({
	root,
	list,
	onOpen,
	onDirectory,
	onError,
	refreshKey,
	selectedPath,
	onRename,
	onController,
	renderContextMenu,
}: {
	root: string;
	list(absolutePath: string): Promise<RemoteTreeEntry[]>;
	onOpen(absolutePath: string): void;
	onDirectory(absolutePath: string): void;
	onError(error: Error): void;
	refreshKey: number;
	selectedPath?: string;
	onRename?(absolutePath: string): void;
	onController?(controller: FileTreeController | null): void;
	renderContextMenu?: React.ComponentProps<
		typeof FileTreeSurface
	>["renderContextMenu"];
}) {
	const { t } = useLingui();
	const latest = useRef({
		list,
		onOpen,
		onDirectory,
		onError,
		onRename,
		onController,
	});
	latest.current = {
		list,
		onOpen,
		onDirectory,
		onError,
		onRename,
		onController,
	};
	const controllerRef = useRef<FileTreeController | null>(null);
	const { model } = useFileTree({
		paths: [],
		initialExpansion: "closed",
		search: false,
		unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
		icons: { set: "complete", colored: true },
		itemHeight: FILE_EXPLORER_ROW_HEIGHT,
		overscan: FILE_EXPLORER_OVERSCAN,
		stickyFolders: true,
		onSelectionChange: (paths) => {
			const path = paths.at(-1);
			if (!path || !controllerRef.current) return;
			const absolute = controllerRef.current.absolutePath(path);
			if (path.endsWith("/")) latest.current.onDirectory(absolute);
			else {
				latest.current.onDirectory(
					absolute.slice(0, absolute.lastIndexOf("/")) || "/",
				);
				latest.current.onOpen(absolute);
			}
		},
	});
	useFallthroughIcons(model);
	useEffect(() => {
		const controller = new FileTreeController(
			model,
			root,
			(path) => latest.current.list(path),
			{ onError: (error) => latest.current.onError(error) },
		);
		controllerRef.current = controller;
		latest.current.onController?.(controller);
		controller.start();
		return () => {
			controller.stop();
			if (controllerRef.current === controller) {
				controllerRef.current = null;
				latest.current.onController?.(null);
			}
		};
	}, [model, root]);
	const lastRefresh = useRef(refreshKey);
	useEffect(() => {
		if (lastRefresh.current === refreshKey) return;
		lastRefresh.current = refreshKey;
		void controllerRef.current?.refresh();
	}, [refreshKey]);
	useEffect(() => {
		if (!selectedPath) return;
		const prefix = root === "/" ? "/" : `${root}/`;
		if (!selectedPath.startsWith(prefix)) return;
		const relative = selectedPath.slice(prefix.length);
		if (model.getItem(relative)) model.focusPath(relative);
	}, [model, root, selectedPath]);
	const policy = buildPolicy(
		DEFAULT_V2_USER_PREFERENCES.sidebarFileLinks,
		"file",
		"4-tier",
	);
	const { onClickCapture } = usePierreRowClickPolicy({
		filePolicy: policy,
		onSelectFile: (path) => {
			const controller = controllerRef.current;
			if (!controller) return;
			const absolute = controller.absolutePath(path);
			latest.current.onDirectory(
				absolute.slice(0, absolute.lastIndexOf("/")) || "/",
			);
			latest.current.onOpen(absolute);
		},
		onRename: (path) => {
			const controller = controllerRef.current;
			if (controller) latest.current.onRename?.(controller.absolutePath(path));
		},
		openInExternalEditor: () =>
			latest.current.onError(
				new Error(
					t({
						message: "Can't open remote workspace paths in an external editor",
					}),
				),
			),
	});
	return (
		<div
			className="flex flex-col flex-1 h-full min-h-0 overflow-hidden"
			onClickCapture={onClickCapture}
		>
			<div data-file-tree-header="true" className="flex justify-end h-8">
				<FilesTabHeaderButton
					icon={FoldVertical}
					label={t({ message: "Collapse All" })}
					onClick={() => controllerRef.current?.collapseAll()}
				/>
			</div>
			<FileTreeSurface
				model={model}
				className="flex-1 min-h-0"
				renderContextMenu={renderContextMenu}
			/>
		</div>
	);
}
