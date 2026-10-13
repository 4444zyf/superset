import { Trans, useLingui } from "@lingui/react/macro";
import { darkTheme } from "@superset/shared/themes";
import { Button } from "@superset/ui/button";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { detectLanguage } from "shared/detect-language";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";

const CodeEditorSurface = lazy(() =>
	import(
		"renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditorSurface"
	).then((module) => ({ default: module.CodeEditorSurface })),
);

interface Entry {
	absolutePath: string;
	name: string;
	kind: "file" | "directory" | "symlink" | "other";
}
interface ReadResult {
	kind: "text" | "bytes";
	content: string;
	exceededLimit: boolean;
	revision: string;
}
interface Editor {
	absolutePath: string;
	original: string;
	content: string;
	revision: string;
	truncated: boolean;
	binary: boolean;
	lineEnding: "\n" | "\r\n";
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

function editorFromRead(absolutePath: string, result: ReadResult): Editor {
	let content = result.content;
	let binary = false;
	try {
		if (result.kind === "bytes") {
			const bytes = Uint8Array.from(atob(result.content), (character) =>
				character.charCodeAt(0),
			);
			content = new TextDecoder("utf-8", {
				fatal: true,
				ignoreBOM: true,
			}).decode(bytes);
		}
		binary = content.includes("\0");
	} catch {
		binary = true;
		content = "";
	}
	const lineEnding =
		content.includes("\r\n") && !/(^|[^\r])\n/.test(content) ? "\r\n" : "\n";
	if (lineEnding === "\r\n") content = content.replaceAll("\r\n", "\n");
	return {
		absolutePath,
		original: content,
		content,
		revision: result.revision,
		truncated: result.exceededLimit,
		binary,
		lineEnding,
	};
}

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
	const { t } = useLingui();
	const [tab, setTab] = useState<"files" | "changes">("files");
	const [root, setRoot] = useState("");
	const [directory, setDirectory] = useState("");
	const [entries, setEntries] = useState<Entry[]>([]);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [category, setCategory] = useState<Category>("unstaged");
	const [diff, setDiff] = useState<(Diff & { path: string }) | null>(null);
	const [busy, setBusy] = useState(false);
	const epoch = useRef(0);
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;
	const gitAvailableRef = useRef(connection.capabilities?.git === true);
	gitAvailableRef.current = connection.capabilities?.git === true;
	const dirty = editor !== null && editor.original !== editor.content;
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
	const run = async (execute: (version: number) => Promise<void>) => {
		const version = epoch.current;
		setBusy(true);
		try {
			await execute(version);
		} catch (error) {
			if (version === epoch.current) report(error);
		} finally {
			if (version === epoch.current) setBusy(false);
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
		setRoot("");
		setDirectory("");
		setEntries([]);
		setEditor(null);
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
	const save = () =>
		run(async (version) => {
			if (!editor || editor.truncated || editor.binary || !dirty) return;
			const content = editor.content;
			const result = await rpc<
				{ ok: true; revision: string } | { ok: false; reason: string }
			>("filesystem.writeFile", "mutation", {
				workspaceId,
				absolutePath: editor.absolutePath,
				content:
					editor.lineEnding === "\r\n"
						? content.replaceAll("\n", "\r\n")
						: content,
				options: { create: false, overwrite: true },
				precondition: { ifMatch: editor.revision },
			});
			if (version !== epoch.current) return;
			if (!result.ok)
				throw new Error(
					result.reason === "conflict"
						? t({
								message:
									"This file changed on the remote machine. Your draft is preserved; reload before saving.",
							})
						: t({
								message:
									"The remote file could not be saved. Your draft is preserved.",
							}),
				);
			setEditor((previous) =>
				previous
					? { ...previous, original: content, revision: result.revision }
					: null,
			);
			await refreshGit(version);
		});
	const openFile = (absolutePath: string) =>
		run(async (version) => {
			const result = await rpc<ReadResult>("filesystem.readFile", "query", {
				workspaceId,
				absolutePath,
				maxBytes: 1024 * 1024,
			});
			if (version === epoch.current)
				setEditor(editorFromRead(absolutePath, result));
		});
	return (
		<section className="flex-1 min-h-0 overflow-auto p-3 space-y-3 bg-background text-foreground">
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
			{tab === "files" ? (
				<>
					<code className="block text-xs break-all">{directory}</code>
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
							<Button
								variant="outline"
								size="sm"
								type="button"
								key={entry.absolutePath}
								className={button}
								disabled={busy || dirty || entry.kind === "other"}
								onClick={() =>
									void (entry.kind === "directory"
										? run((version) => browse(entry.absolutePath, version))
										: openFile(entry.absolutePath))
								}
							>
								{entry.name}
								{entry.kind === "directory" ? "/" : ""}
							</Button>
						))}
					</div>
					{editor && (
						<div className="space-y-2">
							<code className="block text-xs break-all">
								{editor.absolutePath}
							</code>
							{editor.binary ? (
								<p className="text-sm text-muted-foreground">
									<Trans>Binary files cannot be edited here.</Trans>
								</p>
							) : (
								<>
									{editor.truncated && (
										<p className="text-sm text-amber-300">
											<Trans>
												This preview is truncated. Saving is disabled.
											</Trans>
										</p>
									)}
									<section
										className="h-80 border border-border rounded-md overflow-hidden"
										aria-label={t({ message: "File contents" })}
									>
										<Suspense
											fallback={
												<div className="p-3 text-muted-foreground">
													<Trans>Files</Trans>
												</div>
											}
										>
											<CodeEditorSurface
												value={editor.content}
												language={detectLanguage(editor.absolutePath)}
												theme={darkTheme}
												readOnly={busy || editor.truncated}
												onChange={(content) =>
													setEditor({ ...editor, content })
												}
												onSave={() => {
													if (!busy && !editor.truncated && dirty) void save();
												}}
											/>
										</Suspense>
									</section>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											type="button"
											className={button}
											disabled={busy || editor.truncated || !dirty}
											onClick={() => void save()}
										>
											<Trans>Save file</Trans>
										</Button>
										<Button
											variant="outline"
											size="sm"
											type="button"
											className={button}
											disabled={busy}
											onClick={() => {
												setEditor(null);
											}}
										>
											<Trans>Close file and discard draft</Trans>
										</Button>
									</div>
								</>
							)}
						</div>
					)}
				</>
			) : (
				<>
					{status && <p className="text-sm">{status.currentBranch.name}</p>}
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
							<Button
								variant="outline"
								size="sm"
								type="button"
								key={file.path}
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
		</section>
	);
}
