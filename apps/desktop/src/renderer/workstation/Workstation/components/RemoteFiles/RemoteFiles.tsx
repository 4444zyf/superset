import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { TooltipProvider } from "@superset/ui/tooltip";
import { FilePlus, FolderPlus } from "lucide-react";
import {
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
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
import { FileActionMenu } from "./components/FileActionMenu/FileActionMenu";
import {
	type FileOperation,
	FileOperationDialog,
} from "./components/FileOperationDialog/FileOperationDialog";
import { RemoteDocumentEditor } from "./components/RemoteDocumentEditor";
import { RemoteFileSearch } from "./components/RemoteFileSearch/RemoteFileSearch";
import { RemoteFileTabs } from "./components/RemoteFileTabs";
import { RemoteGitActions } from "./components/RemoteGitActions/RemoteGitActions";

interface Entry {
	absolutePath: string;
	name: string;
	kind: "file" | "directory" | "symlink" | "other";
}
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
type Category = "staged" | "unstaged" | "against-base";

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
	const [tab, setTab] = useState<"files" | "changes" | "search">("files");
	const [root, setRoot] = useState("");
	const [directory, setDirectory] = useState("");
	const [entries, setEntries] = useState<Entry[]>([]);
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
	const editor = activeDocument
		? { absolutePath: activeDocument.absolutePath }
		: null;
	useEffect(() => {
		if (sharedManager) return;
		return documentsManager.startAutoSave();
	}, [sharedManager, documentsManager]);
	useEffect(() => {
		if (!sharedManager)
			documentsManager.autoSave.setMode(appearance.fileAutoSave);
	}, [sharedManager, documentsManager, appearance.fileAutoSave]);
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [category, setCategory] = useState<Category>("unstaged");
	const [diff, setDiff] = useState<(Diff & { path: string }) | null>(null);
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
			}
		}
	};
	const browse = async (absolutePath: string, version: number) => {
		const result = await rpc<{ entries: Entry[] }>(
			"filesystem.listDirectory",
			"query",
			{ workspaceId, absolutePath },
		);
		if (version === epoch.current) {
			setDirectory(absolutePath);
			setEntries(result.entries);
		}
	};
	const refreshGit = async (version: number) => {
		if (!connection.capabilities?.git) return;
		const result = await rpc<GitStatus>("git.getStatus", "query", {
			workspaceId,
			priority: "foreground",
		});
		if (version === epoch.current) setStatus(result);
	};
	useEffect(() => {
		const version = ++epoch.current;
		running.current = false;
		setRoot("");
		setDirectory("");
		setEntries([]);
		setFileOperation(null);
		setStatus(null);
		setDiff(null);
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
			const result = await api.rpc<{ entries: Entry[] }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "filesystem.listDirectory",
				type: "query",
				input: { workspaceId, absolutePath: workspace.worktreePath },
			});
			if (version === epoch.current) {
				setDirectory(workspace.worktreePath);
				setEntries(result.entries);
			}
		};
		const readStatus = async () => {
			if (!gitAvailableRef.current) return;
			const result = await api.rpc<GitStatus>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path: "git.getStatus",
				type: "query",
				input: { workspaceId, priority: "foreground" },
			});
			if (version === epoch.current) setStatus(result);
		};
		void Promise.allSettled([readRoot(), readStatus()]).then((results) => {
			if (version !== epoch.current) return;
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
	}, [api, connection.connectionId, connection.generation, workspaceId]);
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
				className="flex-1 min-h-0 overflow-auto p-3 space-y-3 bg-background text-foreground"
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
				{tab === "search" ? (
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
				) : tab === "files" ? (
					<>
						<code className="block text-xs break-all">{directory}</code>
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
						<div className="flex gap-2 flex-wrap">
							{directory !== root && directory && (
								<Button
									variant="outline"
									size="sm"
									type="button"
									className={button}
									disabled={busy || dirty}
									onClick={() =>
										void run((version) =>
											browse(
												directory.slice(0, directory.lastIndexOf("/")) || "/",
												version,
											),
										)
									}
								>
									..
								</Button>
							)}
							{entries.map((entry) => (
								<div
									key={entry.absolutePath}
									className="flex items-center gap-1"
								>
									<Button
										data-file-entry-path={entry.absolutePath}
										variant="outline"
										size="sm"
										type="button"
										className={button}
										disabled={busy || entry.kind === "other"}
										onClick={() =>
											void (entry.kind === "directory"
												? run((version) => browse(entry.absolutePath, version))
												: openFile(entry.absolutePath))
										}
									>
										{entry.name}
										{entry.kind === "directory" ? "/" : ""}
									</Button>
									{connection.capabilities?.workstationFilesV1 && (
										<FileActionMenu
											name={entry.name}
											absolutePath={entry.absolutePath}
											disabled={busy || dirty || entry.kind === "other"}
											onOperation={(operation) => {
												if (ownerRef.current === operationOwner)
													setFileOperation(operation);
											}}
										/>
									)}
								</div>
							))}
						</div>
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
											(document) => ids.includes(document.id) && document.dirty,
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
					</>
				) : (
					<>
						{status && <p className="text-sm">{status.currentBranch.name}</p>}
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
							{(category === "against-base"
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
												const result = await rpc<Diff>("git.getDiff", "query", {
													workspaceId,
													path: file.path,
													category,
												});
												if (version === epoch.current)
													setDiff({ ...result, path: file.path });
											})
										}
									>
										{file.path}
									</Button>
									{category !== "against-base" &&
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
							<div className="space-y-2">
								<code className="text-xs break-all">{diff.path}</code>
								<div className="grid grid-cols-2 gap-3">
									<div>
										<h3 className="text-sm">
											<Trans>Before</Trans>
										</h3>
										<pre className="max-h-96 overflow-auto bg-zinc-900 p-2 text-xs">
											{diff.oldFile.contents}
										</pre>
									</div>
									<div>
										<h3 className="text-sm">
											<Trans>After</Trans>
										</h3>
										<pre className="max-h-96 overflow-auto bg-zinc-900 p-2 text-xs">
											{diff.newFile.contents}
										</pre>
									</div>
								</div>
							</div>
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
						onComplete={() =>
							run(async (version) => {
								await Promise.all([
									browse(directory, version),
									refreshGit(version),
								]);
								if (
									version === epoch.current &&
									"absolutePath" in fileOperation &&
									editor?.absolutePath === fileOperation.absolutePath &&
									fileOperation.kind !== "copy"
								)
									if (activeDocument) closeDocument(activeDocument.id);
							})
						}
					/>
				)}
			</section>
		</TooltipProvider>
	);
}
