import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import type {
	FsContentMatch,
	FsSearchMatch,
} from "@superset/workspace-fs/core";
import { useEffect, useRef, useState } from "react";
import { FileSearchResultRow } from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView/components/FileSearchResultItem/components/FileSearchResultRow/FileSearchResultRow";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

type Match = FsSearchMatch | FsContentMatch;

export function RemoteFileSearch({
	api,
	connection,
	workspaceId,
	disabled = false,
	onOpen,
	onError,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	disabled?: boolean;
	onOpen(absolutePath: string, line?: number): void;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	const [query, setQuery] = useState("");
	const [mode, setMode] = useState<"files" | "content">("files");
	const [matches, setMatches] = useState<Match[]>([]);
	const [busy, setBusy] = useState(false);
	const scope = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
	]);
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const requestVersion = useRef(0);
	const resultOwner = useRef(scope);
	const clear = () => {
		requestVersion.current++;
		setBusy(false);
		setMatches([]);
	};
	useEffect(() => {
		if (resultOwner.current === scope) return;
		resultOwner.current = scope;
		requestVersion.current++;
		setQuery("");
		setBusy(false);
		setMatches([]);
	}, [scope]);
	const available = connection.capabilities?.workstationFilesV1 === true;
	const search = async () => {
		if (!available || disabled || busy || !query.trim()) return;
		const version = ++requestVersion.current;
		const owner = scope;
		setBusy(true);
		try {
			const result = await api.rpc<{ matches: Match[] }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path:
					mode === "files"
						? "filesystem.searchFiles"
						: "filesystem.searchContent",
				type: "query",
				input: { workspaceId, query: query.trim(), limit: 100 },
			});
			if (scopeRef.current !== owner || requestVersion.current !== version)
				return;
			if (!Array.isArray(result?.matches))
				throw new Error("Invalid file search response");
			setMatches(
				result.matches
					.slice(0, 100)
					.filter(
						(match) =>
							typeof match?.absolutePath === "string" &&
							typeof match.relativePath === "string" &&
							match.absolutePath.length <= 4096 &&
							match.relativePath.length <= 4096,
					),
			);
		} catch (error) {
			if (scopeRef.current === owner && requestVersion.current === version)
				onError(error instanceof Error ? error.message : String(error));
		} finally {
			if (scopeRef.current === owner && requestVersion.current === version)
				setBusy(false);
		}
	};
	return (
		<section className="space-y-2">
			<div className="flex gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					aria-pressed={mode === "files"}
					onClick={() => {
						clear();
						setMode("files");
					}}
				>
					<Trans>Files</Trans>
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					aria-pressed={mode === "content"}
					onClick={() => {
						clear();
						setMode("content");
					}}
				>
					<Trans>Content</Trans>
				</Button>
			</div>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void search();
				}}
			>
				<Input
					aria-label={t({ message: "Search files" })}
					value={query}
					maxLength={1000}
					onChange={(event) => {
						clear();
						setQuery(event.target.value);
					}}
				/>
				<Button
					type="submit"
					disabled={!available || disabled || busy || !query.trim()}
				>
					<Trans>Search</Trans>
				</Button>
			</form>
			{busy && (
				<p className="text-sm text-muted-foreground">
					<Trans>Searching...</Trans>
				</p>
			)}
			<div className="space-y-1">
				{matches.map((match, index) =>
					"line" in match ? (
						<Button
							key={`${match.absolutePath}:${match.line}:${index}`}
							type="button"
							variant="ghost"
							data-search-path={match.absolutePath}
							data-search-line={match.line}
							className="h-auto w-full justify-start text-left whitespace-normal"
							disabled={disabled}
							onClick={() => onOpen(match.absolutePath, match.line)}
						>
							<span>
								<span className="block text-xs">
									{match.relativePath}:{match.line}
								</span>
								<span className="block text-xs text-muted-foreground">
									{typeof match.preview === "string"
										? match.preview.slice(0, 1000)
										: ""}
								</span>
							</span>
						</Button>
					) : (
						<FileSearchResultRow
							key={match.absolutePath}
							data-search-path={match.absolutePath}
							role="button"
							tabIndex={disabled ? -1 : 0}
							aria-label={match.relativePath}
							aria-disabled={disabled || match.kind === "directory"}
							entry={{
								id: match.absolutePath,
								name: match.name,
								path: match.absolutePath,
								relativePath: match.relativePath,
								isDirectory: match.kind === "directory",
							}}
							onClick={() => {
								if (!disabled && match.kind !== "directory")
									onOpen(match.absolutePath);
							}}
							onKeyDown={(event) => {
								if (
									(event.key === "Enter" || event.key === " ") &&
									!disabled &&
									match.kind !== "directory"
								) {
									event.preventDefault();
									onOpen(match.absolutePath);
								}
							}}
						/>
					),
				)}
			</div>
		</section>
	);
}
