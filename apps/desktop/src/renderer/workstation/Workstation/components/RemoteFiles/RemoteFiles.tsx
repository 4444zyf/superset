import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@superset/ui/resizable";
import { TooltipProvider } from "@superset/ui/tooltip";
import { FilePlus, FolderPlus } from "lucide-react";
import {
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { PierreRowContextMenu } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/PierreRowContextMenu";
import { FilesTabHeaderButton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/components/FilesTabHeaderButton/FilesTabHeaderButton";
import { StageToggleButton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/useChangesTab/components/ChangesFileList/components/StageToggleButton/StageToggleButton";
import type {
	SaveResult,
	SharedFileDocument,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/types";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import {
	useWorkstationFileDocuments,
	WorkstationFileDocumentsContext,
} from "../../providers/WorkstationFileDocuments";
import { useWorkstationAppearance } from "../../providers/WorkstationPreferencesContext";
import { CloseFileDialog } from "./components/CloseFileDialog";
import { FileActionItems } from "./components/FileActionMenu/components/FileActionItems/FileActionItems";
import {
	type FileOperation,
	FileOperationDialog,
} from "./components/FileOperationDialog/FileOperationDialog";
import { RemoteBaseBranch } from "./components/RemoteBaseBranch/RemoteBaseBranch";
import { RemoteBranchActions } from "./components/RemoteBranchActions/RemoteBranchActions";
import { RemoteDocumentEditor } from "./components/RemoteDocumentEditor";
import { RemoteFileSearch } from "./components/RemoteFileSearch/RemoteFileSearch";
import { RemoteFileTabs } from "./components/RemoteFileTabs";
import type { FileTreeController } from "./components/RemoteFileTree/file-tree-controller";
import { RemoteFileTree } from "./components/RemoteFileTree/RemoteFileTree";
import { RemoteGitActions } from "./components/RemoteGitActions/RemoteGitActions";
import { RemoteGitDiff } from "./components/RemoteGitDiff/RemoteGitDiff";
import {
	RemoteGitHistory,
	type RemoteHistoryCommit,
} from "./components/RemoteGitHistory/RemoteGitHistory";

interface ChangedFile {
	path: string;
	status: string;
	isBinary?: boolean;
}
interface GitStatus {
	currentBranch: { name: string };
	staged: ChangedFile[];
	unstaged: ChangedFile[];
	againstBase: ChangedFile[];
}
interface Diff {
	oldFile: { contents: string };
	newFile: { contents: string };
}
type Category = "staged" | "unstaged" | "against-base" | "commit";

const button = "justify-start text-xs";

export function RemoteFiles({
	api,
	connection,
	workspaceId,
	onError,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	onError(message: string): void;
}) {
	const appearance = useWorkstationAppearance();
	const { t } = useLingui();
	const [tab, setTab] = useState<"files" | "changes" | "search" | "history">(
		"files",
	);
	const [root, setRoot] = useState("");
	const [directory, setDirectory] = useState("");
	const [treeRefresh, setTreeRefresh] = useState(0);
	const treeController = useRef<FileTreeController | null>(null);
	const pendingTreeOperation = useRef<FileOperation | null>(null);
	const sharedManager = useContext(WorkstationFileDocumentsContext);
	const documentsManager = useWorkstationFileDocuments(api);
	useSyncExternalStore(
		documentsManager.subscribe,
		documentsManager.getVersion,
		documentsManager.getVersion,
	);
	const documentView = documentsManager.getView(connection, workspaceId);
	const documents = documentsManager
		.getDocuments(connection, workspaceId)
		.sort((a, b) => {
			const first = documentView.order.indexOf(a.id);
			const second = documentView.order.indexOf(b.id);
			return (first < 0 ? 1000 : first) - (second < 0 ? 1000 : second);
		});
	const activeDocument =
		documents.find((document) => document.id === documentView.activeId) ??
		documents[0];

	useEffect(() => {
		if (sharedManager) return;
		return documentsManager.startAutoSave();
	}, [sharedManager, documentsManager]);
	useEffect(() => {
		if (!sharedManager)
			documentsManager.autoSave.setMode(appearance.fileAutoSave);
	}, [sharedManager, documentsManager, appearance.fileAutoSave]);
	const [status, setStatus] = useState<GitStatus | null>(null);
	const baseBranchRef = useRef<string | undefined>(undefined);
	const pendingBaseRefresh = useRef(false);
	const [category, setCategory] = useState<Category>("unstaged");
	const [diff, setDiff] = useState<(Diff & { path: string }) | null>(null);
	const [selectedCommit, setSelectedCommit] = useState<{
		commit: RemoteHistoryCommit;
		files: ChangedFile[];
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [closeIds, setCloseIds] = useState<string[]>([]);
	const [fileOperation, setFileOperation] = useState<FileOperation | null>(
		null,
	);
	const operationOwner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const ownerRef = useRef(operationOwner);
	ownerRef.current = operationOwner;
	const epoch = useRef(0);
	const running = useRef(false);
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;
	const gitAvailableRef = useRef(connection.capabilities?.git === true);
	gitAvailableRef.current = connection.capabilities?.git === true;
	const dirty = activeDocument?.dirty ?? false;
	const rpc = <T,>(path: string, type: "query" | "mutation", input: unknown) =>
		api.rpc<T>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path,
			type,
			input,
		});
	const report = (error: unknown) =>
		onErrorRef.current(error instanceof Error ? error.message : String(error));
	const run = async (
		execute: (version: number) => Promise<void>,
		onFailure?: (error: unknown) => void,
	) => {
		if (running.current) return;
		running.current = true;
		const version = epoch.current;
		setBusy(true);
		try {
			await execute(version);
		} catch (error) {
			if (version === epoch.current) {
				onFailure?.(error);
				report(error);
			}
		} finally {
			if (version === epoch.current) {
				running.current = false;
				setBusy(false);
				if (pendingBaseRefresh.current) {
					pendingBaseRefresh.current = false;
					void run(refreshGit);
				}
			}
		}
	};
	const browse = async (_absolutePath: string, version: number) => {
		if (version !== epoch.current) return;
		if (treeController.current) {
			await treeController.current.refresh();
			if (
				version === epoch.current &&
				!treeController.current?.containsDirectory(_absolutePath)
			)
				setDirectory(root);
		} else setTreeRefresh((value) => value + 1);
	};
	const refreshGit = async (version: number) => {
		if (!connection.capabilities?.git) return;
		const requestedBase = baseBranchRef.current;
		const result = await rpc<GitStatus>("git.getStatus", "query", {
			workspaceId,
			priority: "foreground",
			...(requestedBase ? { baseBranch: requestedBase } : {}),
		});
		if (version === epoch.current && requestedBase === baseBranchRef.current)
			setStatus(result);
	};
	useEffect(() => {
		const version = ++epoch.current;
		running.current = false;
		setRoot("");
		setDirectory("");
		pendingTreeOperation.current = null;
		setFileOperation(null);
		setStatus(null);
		baseBranchRef.current = undefined;
		pendingBaseRefresh.current = false;
		setDiff(null);
		setSelectedCommit(null);
		setBusy(true);
		const readRoot = async () => {
			const workspace = await api.rpc<{ worktreePath: string }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "workspace.get",
				type: "query",
				input: { id: workspaceId },
			});
			if (version !== epoch.current) return;
			setRoot(workspace.worktreePath);
			if (version === epoch.current) setDirectory(workspace.worktreePath);
		};
		const readStatus = async () => {
			if (!gitAvailableRef.current) return;
			const requestedBase = baseBranchRef.current;
			const result = await api.rpc<GitStatus>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "git.getStatus",
				type: "query",
				input: {
					workspaceId,
					priority: "foreground",
					...(requestedBase ? { baseBranch: requestedBase } : {}),
				},
			});
			if (version === epoch.current && requestedBase === baseBranchRef.current)
				setStatus(result);
		};
		void Promise.allSettled([readRoot(), readStatus()]).then((results) => {
			if (version !== epoch.current || ownerRef.current !== operationOwner)
				return;
			for (const result of results)
				if (result.status === "rejected")
					onErrorRef.current(
						result.reason instanceof Error
							? result.reason.message
							: String(result.reason),
					);
			setBusy(false);
		});
		return () => {
			epoch.current++;
		};
	}, [
		api,
		connection.connectionId,
		connection.generation,
		workspaceId,
		operationOwner,
	]);
	const closeDocument = (id: string) => {
		const document = documents.find((document) => document.id === id);
		if (!document) return;
		try {
			documentsManager.discard(connection, workspaceId, document.absolutePath);
		} catch (error) {
			report(error);
		}
	};
	const save = async (
		document: SharedFileDocument = activeDocument,
	): Promise<SaveResult> => {
		let result: SaveResult = {
			status: "error",
			error: new Error("File is unavailable for saving"),
		};
		await run(async (version) => {
			if (!document || !document.dirty) return;
			result = await document.save();
			if (version !== epoch.current) return;
			if (result.status === "conflict" || result.status === "error") return;
			if (result.status !== "saved")
				throw new Error(
					t({
						message:
							"The remote file could not be saved. Your draft is preserved.",
					}),
				);
			await refreshGit(version);
		});
		return result;
	};
	const openFile = (absolutePath: string, revealLine?: number) =>
		run(async (version) => {
			if (version !== epoch.current) return;
			const existing = documentsManager
				.getDocuments(connection, workspaceId)
				.find((document) => document.absolutePath === absolutePath);
			const document =
				existing ??
				documentsManager.acquire(connection, workspaceId, absolutePath);
			documentsManager.updateView(connection, workspaceId, {
				activeId: document.id,
				...(revealLine
					? {
							revealLines: {
								...documentView.revealLines,
								[document.id]: revealLine,
							},
						}
					: {}),
			});
		});

	return (
		<TooltipProvider>
			<section
				data-workspace-files={workspaceId}
				className="flex-1 min-h-0 flex flex-col overflow-auto p-3 gap-3 bg-background text-foreground"
			>
				<div className="flex gap-2 flex-wrap">
					<Button
						variant="outline"
						size="sm"
						type="button"
						className={button}
						onClick={() => setTab("files")}
						aria-pressed={tab === "files"}
					>
						<Trans>Files</Trans>
					</Button>
					<Button
						variant="outline"
						size="sm"
						type="button"
						className={button}
						onClick={() => setTab("changes")}
						disabled={!connection.capabilities?.git}
						aria-pressed={tab === "changes"}
					>
						<Trans>Changes</Trans>
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={
							!connection.capabilities?.git ||
							!connection.capabilities?.workstationGitHistoryV1
						}
						aria-pressed={tab === "history"}
						onClick={() => setTab("history")}
					>
						<Trans>History</Trans>
					</Button>
					<Button
						variant="outline"
						size="sm"
						type="button"
						disabled={!connection.capabilities?.workstationFilesV1}
						aria-pressed={tab === "search"}
						onClick={() => setTab("search")}
					>
						<Trans>Search files</Trans>
					</Button>
					<Button
						variant="outline"
						size="sm"
						type="button"
						className={button}
						disabled={busy || !directory}
						onClick={() =>
							void run(async (version) => {
								await Promise.all([
									browse(directory, version),
									refreshGit(version),
								]);
							})
						}
					>
						<Trans>Refresh files and Git</Trans>
					</Button>
				</div>
				{tab === "history" && (
					<RemoteGitHistory
						key={operationOwner}
						api={api}
						connection={connection}
						workspaceId={workspaceId}
						disabled={busy}
						onError={report}
						onSelect={(commit) => {
							void run(async (version) => {
								const result = await rpc<{ files: ChangedFile[] }>(
									"git.getCommitFiles",
									"query",
									{ workspaceId, commitHash: commit.hash },
								);
								if (version !== epoch.current) return;
								setSelectedCommit({ commit, files: result.files });
								setCategory("commit");
								setDiff(null);
								setTab("changes");
							});
						}}
					/>
				)}
				{tab === "search" && (
					<RemoteFileSearch
						api={api}
						connection={connection}
						workspaceId={workspaceId}
						disabled={busy}
						onError={report}
						onOpen={(path, line) => {
							if (!busy) {
								setTab("files");
								void openFile(path, line);
							}
						}}
					/>
				)}
				<div
					hidden={tab !== "files"}
					className="flex min-h-0 flex-1"
					style={tab !== "files" ? { display: "none" } : undefined}
				>
					<ResizablePanelGroup
						direction="horizontal"
						className="min-h-96 flex-1"
					>
						<ResizablePanel defaultSize={30} minSize={18} maxSize={65}>
							<div className="flex h-full min-h-0 flex-col gap-2 pr-2">
								<code className="block text-xs truncate" title={directory}>
									{directory}
								</code>
								<div className="flex gap-1">
									<FilesTabHeaderButton
										icon={FilePlus}
										label={t({ message: "New File..." })}
										disabled={
											busy ||
											dirty ||
											!directory ||
											!connection.capabilities?.workstationFilesV1
										}
										onClick={() => setFileOperation({ kind: "newFile" })}
									/>
									<FilesTabHeaderButton
										icon={FolderPlus}
										label={t({ message: "New Folder..." })}
										disabled={
											busy ||
											dirty ||
											!directory ||
											!connection.capabilities?.workstationFilesV1
										}
										onClick={() => setFileOperation({ kind: "newFolder" })}
									/>
								</div>
								{root && (
									<RemoteFileTree
										key={operationOwner}
										root={root}
										refreshKey={treeRefresh}
										onController={(controller) => {
											treeController.current = controller;
										}}
										selectedPath={activeDocument?.absolutePath}
										list={async (absolutePath) =>
											(
												await rpc<{
													entries: import("./components/RemoteFileTree/file-tree-controller").RemoteTreeEntry[];
												}>("filesystem.listDirectory", "query", {
													workspaceId,
													absolutePath,
												})
											).entries
										}
										onDirectory={setDirectory}
										onOpen={(absolutePath) => {
											void openFile(absolutePath);
										}}
										onError={report}
										onRename={(absolutePath) => {
											if (
												!busy &&
												!dirty &&
												connection.capabilities?.workstationFilesV1
											)
												setFileOperation({ kind: "rename", absolutePath });
										}}
										renderContextMenu={
											connection.capabilities?.workstationFilesV1
												? (item, ctx) => (
														<PierreRowContextMenu
															anchorRect={ctx.anchorRect}
															onClose={ctx.close}
															data-file-tree-context-menu-root="true"
															onCloseAutoFocus={(event: Event) => {
																const operation = pendingTreeOperation.current;
																pendingTreeOperation.current = null;
																if (
																	!operation ||
																	ownerRef.current !== operationOwner
																)
																	return;
																event.preventDefault();
																setFileOperation(operation);
															}}
														>
															<FileActionItems
																absolutePath={`${root === "/" ? "" : root}/${item.path.replace(/\/$/, "")}`}
																disabled={busy || dirty}
																onChoose={(operation) => {
																	pendingTreeOperation.current = operation;
																}}
															/>
														</PierreRowContextMenu>
													)
												: undefined
										}
									/>
								)}
							</div>
						</ResizablePanel>
						<ResizableHandle />
						<ResizablePanel defaultSize={70} minSize={25}>
							<div className="h-full overflow-auto pl-2 space-y-2">
								{documents.length > 0 && (
									<RemoteFileTabs
										documents={documents}
										activeId={activeDocument?.id ?? null}
										labels={documentView.labels}
										onSelect={(id) =>
											documentsManager.updateView(connection, workspaceId, {
												activeId: id,
											})
										}
										onClose={(ids) => {
											if (
												documents.some(
													(document) =>
														ids.includes(document.id) && document.dirty,
												)
											)
												setCloseIds(ids);
											else for (const id of ids) closeDocument(id);
										}}
										onRename={(id, name) => {
											const labels = { ...documentView.labels };
											if (name) labels[id] = name;
											else delete labels[id];
											documentsManager.updateView(connection, workspaceId, {
												labels,
											});
										}}
										onOrder={(id, index) => {
											const order = documents
												.map((document) => document.id)
												.filter((value) => value !== id);
											order.splice(index, 0, id);
											documentsManager.updateView(connection, workspaceId, {
												order,
											});
										}}
									/>
								)}
								{documents.map((document) => (
									<RemoteDocumentEditor
										key={document.id}
										document={document}
										active={document.id === activeDocument?.id}
										busy={busy}
										revealLine={documentView.revealLines[document.id]}
										onSave={() => {
											void save(document);
										}}
										onClose={() => closeDocument(document.id)}
										onFocusChange={() =>
											documentsManager.autoSave.onFocusChange(document)
										}
										onError={report}
									/>
								))}
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
				{tab === "changes" && (
					<>
						<RemoteBranchActions
							key={operationOwner}
							api={api}
							connection={connection}
							workspaceId={workspaceId}
							revision={status}
							disabled={busy}
							hasDirtyDocuments={documents.some(
								(document) => document.dirty || document.pendingSave,
							)}
							onWorktreeChange={() => {
								documentsManager.dispatchFsEvent(connection, workspaceId, {
									kind: "overflow",
									absolutePath: root,
								});
								setTreeRefresh((value) => value + 1);
							}}
							onError={report}
							onRefresh={() =>
								run(async (version) => {
									await refreshGit(version);
									if (version === epoch.current) setDiff(null);
								})
							}
						/>
						{connection.capabilities?.workstationGitV1 && (
							<RemoteBaseBranch
								key={`${operationOwner}:${status?.currentBranch.name ?? ""}`}
								api={api}
								connection={connection}
								workspaceId={workspaceId}
								disabled={busy}
								onError={report}
								onChange={(value) => {
									if (value === baseBranchRef.current) return;
									baseBranchRef.current = value;
									pendingBaseRefresh.current = true;
									if (category === "against-base") setDiff(null);
									void run(async (version) => {
										pendingBaseRefresh.current = false;
										await refreshGit(version);
									});
								}}
							/>
						)}
						{category === "commit" && selectedCommit && (
							<code className="text-xs">
								{selectedCommit.commit.shortHash} ·{" "}
								{selectedCommit.commit.message}
							</code>
						)}
						<RemoteGitActions
							api={api}
							connection={connection}
							workspaceId={workspaceId}
							hasStagedChanges={!!status?.staged.length}
							disabled={busy || dirty}
							onError={report}
							onRefresh={() =>
								run(async (version) => {
									await refreshGit(version);
									if (version === epoch.current) setDiff(null);
								})
							}
						/>
						<div className="flex gap-2 flex-wrap">
							<Button
								variant="outline"
								size="sm"
								type="button"
								className={button}
								disabled={busy}
								onClick={() => {
									setCategory("unstaged");
									setDiff(null);
								}}
								aria-pressed={category === "unstaged"}
							>
								<Trans>Unstaged</Trans>
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								className={button}
								disabled={busy}
								onClick={() => {
									setCategory("staged");
									setDiff(null);
								}}
								aria-pressed={category === "staged"}
							>
								<Trans>Staged</Trans>
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								className={button}
								disabled={busy}
								onClick={() => {
									setCategory("against-base");
									setDiff(null);
								}}
								aria-pressed={category === "against-base"}
							>
								<Trans>Against base</Trans>
							</Button>
						</div>
						<div className="space-y-1">
							{(category === "commit"
								? selectedCommit?.files
								: category === "against-base"
									? status?.againstBase
									: status?.[category]
							)?.map((file) => (
								<div
									key={file.path}
									data-git-path={file.path}
									className="flex items-center gap-2"
								>
									<Button
										variant="outline"
										size="sm"
										type="button"
										className={`${button} block`}
										disabled={busy || file.isBinary}
										onClick={() =>
											void run(async (version) => {
												const requestedBase = baseBranchRef.current;
												const result = await rpc<Diff>("git.getDiff", "query", {
													workspaceId,
													path: file.path,
													category,
													...(category === "against-base" && requestedBase
														? { baseBranch: requestedBase }
														: {}),
													...(category === "commit" && selectedCommit
														? { commitHash: selectedCommit.commit.hash }
														: {}),
												});
												if (
													version === epoch.current &&
													(category !== "against-base" ||
														requestedBase === baseBranchRef.current)
												)
													setDiff({ ...result, path: file.path });
											})
										}
									>
										{file.path}
									</Button>
									{category !== "against-base" &&
										category !== "commit" &&
										connection.capabilities?.workstationGitV1 && (
											<StageToggleButton
												action={category === "staged" ? "unstage" : "stage"}
												disabled={busy || dirty}
												onClick={() =>
													void run(async (version) => {
														await rpc(
															category === "staged"
																? "git.unstageFile"
																: "git.stageFile",
															"mutation",
															{ workspaceId, filePath: file.path },
														);
														if (version === epoch.current) {
															await refreshGit(version);
															setDiff(null);
														}
													})
												}
											/>
										)}
								</div>
							))}
						</div>
						{diff && (
							<RemoteGitDiff
								key={`${category}:${diff.path}`}
								path={diff.path}
								original={diff.oldFile.contents}
								modified={diff.newFile.contents}
							/>
						)}
					</>
				)}
				<CloseFileDialog
					documents={documents.filter((document) =>
						closeIds.includes(document.id),
					)}
					onCancel={() => setCloseIds([])}
					onDiscard={() => {
						for (const id of closeIds) closeDocument(id);
						setCloseIds([]);
					}}
				/>
				{fileOperation && (
					<FileOperationDialog
						api={api}
						connection={connection}
						workspaceId={workspaceId}
						root={root}
						directory={directory}
						operation={fileOperation}
						onClose={() => setFileOperation(null)}
						onError={report}
						onComplete={(absolutePath) =>
							run(async (version) => {
								if (
									"absolutePath" in fileOperation &&
									fileOperation.kind !== "copy"
								)
									documentsManager.dispatchFsEvent(
										connection,
										workspaceId,
										fileOperation.kind === "delete"
											? {
													kind: "delete",
													absolutePath: fileOperation.absolutePath,
													isDirectory: true,
												}
											: {
													kind: "rename",
													oldAbsolutePath: fileOperation.absolutePath,
													absolutePath,
													isDirectory: true,
												},
									);
								await Promise.all([
									browse(directory, version),
									refreshGit(version),
								]);
							})
						}
					/>
				)}
			</section>
		</TooltipProvider>
	);
}
