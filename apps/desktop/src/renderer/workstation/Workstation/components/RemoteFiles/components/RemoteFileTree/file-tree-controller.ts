import type { FileTree } from "@pierre/trees";
import { collapseFileTreeDirectories } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/utils/collapseFileTreeDirectories/collapseFileTreeDirectories";
import {
	asDirectoryHandle,
	stripTrailingSlash,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/components/FilesTab/utils/treePath";

export interface RemoteTreeEntry {
	absolutePath: string;
	kind: "file" | "directory" | "symlink" | "other";
}
export class FileTreeController {
	private readonly root: string;
	private readonly directories = new Map<string, RemoteTreeEntry[]>();
	private readonly pending = new Map<string, Promise<void>>();
	private epoch = 0;
	private running = false;
	private applying = false;
	private unsubscribe: (() => void) | null = null;
	private readonly maxPaths: number;
	constructor(
		private readonly model: FileTree,
		root: string,
		private readonly list: (absolutePath: string) => Promise<RemoteTreeEntry[]>,
		private readonly options: {
			maxPaths?: number;
			onError?(error: Error): void;
		} = {},
	) {
		this.root = root === "/" ? root : stripTrailingSlash(root);
		this.maxPaths = options.maxPaths ?? 10000;
		if (
			!this.root.startsWith("/") ||
			!Number.isSafeInteger(this.maxPaths) ||
			this.maxPaths < 1 ||
			this.maxPaths > 50000
		)
			throw new Error("Invalid remote tree limits");
	}
	absolutePath(relative: string): string {
		return relative
			? `${this.root === "/" ? "" : this.root}/${stripTrailingSlash(relative)}`
			: this.root;
	}
	containsDirectory(absolutePath: string): boolean {
		if (absolutePath === this.root) return true;
		const prefix = this.root === "/" ? "/" : `${this.root}/`;
		if (!absolutePath.startsWith(prefix)) return false;
		return (
			asDirectoryHandle(
				this.model.getItem(`${absolutePath.slice(prefix.length)}/`),
			) !== null
		);
	}

	start(): void {
		if (this.running) this.stop();
		this.running = true;
		this.epoch++;
		this.directories.clear();
		this.pending.clear();
		this.model.resetPaths([]);
		this.unsubscribe = this.model.subscribe(() => this.loadExpanded());
		void this.fetch("");
	}
	stop(): void {
		this.running = false;
		this.epoch++;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.pending.clear();
	}
	private report(error: unknown): void {
		this.options.onError?.(
			error instanceof Error ? error : new Error(String(error)),
		);
	}
	private validate(directory: string, entries: RemoteTreeEntry[]): void {
		const prefix = `${this.absolutePath(directory).replace(/\/$/, "")}/`;
		for (const entry of entries) {
			const name = entry.absolutePath.slice(prefix.length);
			if (
				!entry.absolutePath.startsWith(prefix) ||
				!name ||
				name.includes("/") ||
				name === "." ||
				name === ".." ||
				name.includes("\0")
			)
				throw new Error("Invalid remote directory entry");
		}
	}
	private paths(snapshot: Map<string, RemoteTreeEntry[]>): string[] {
		const prefix = this.root === "/" ? "/" : `${this.root}/`;
		const paths = new Set<string>();
		for (const entries of snapshot.values())
			for (const entry of entries)
				if (entry.kind !== "other") {
					const relative = entry.absolutePath.slice(prefix.length);
					paths.add(entry.kind === "directory" ? `${relative}/` : relative);
				}
		if (paths.size > this.maxPaths)
			throw new Error("Remote file tree limit reached");
		return [...paths];
	}
	private install(
		snapshot: Map<string, RemoteTreeEntry[]>,
		append = false,
	): void {
		const paths = this.paths(snapshot);
		this.applying = true;
		try {
			if (append) {
				const existing = new Set(this.paths(this.directories));
				this.model.batch(
					paths
						.filter((path) => !existing.has(path))
						.map((path) => ({ type: "add" as const, path })),
				);
			} else {
				const expanded = this.paths(this.directories).filter(
					(path) =>
						path.endsWith("/") &&
						asDirectoryHandle(this.model.getItem(path))?.isExpanded(),
				);
				const focused = this.model.getFocusedPath();
				this.model.resetPaths(paths, {
					initialExpandedPaths: expanded.filter((path) => paths.includes(path)),
				});
				if (focused && paths.includes(focused)) this.model.focusPath(focused);
			}
			this.directories.clear();
			for (const [directory, entries] of snapshot)
				this.directories.set(directory, entries);
		} finally {
			this.applying = false;
		}
		this.loadExpanded();
	}
	private loadExpanded(): void {
		if (!this.running || this.applying) return;
		const prefix = this.root === "/" ? "/" : `${this.root}/`;
		for (const entries of this.directories.values())
			for (const entry of entries)
				if (entry.kind === "directory") {
					const relative = entry.absolutePath.slice(prefix.length);
					if (
						!this.directories.has(relative) &&
						asDirectoryHandle(this.model.getItem(`${relative}/`))?.isExpanded()
					)
						void this.fetch(relative);
				}
	}
	private fetch(directory: string): Promise<void> {
		const existing = this.pending.get(directory);
		if (existing) return existing;
		const epoch = this.epoch;
		const task = (async () => {
			try {
				const entries = await this.list(this.absolutePath(directory));
				if (!this.running || this.epoch !== epoch) return;
				this.validate(directory, entries);
				const next = new Map(this.directories);
				next.set(directory, entries);
				this.install(next, true);
			} catch (error) {
				if (this.running && this.epoch === epoch) this.report(error);
			}
		})();
		this.pending.set(directory, task);
		void task.finally(() => {
			if (this.pending.get(directory) === task) this.pending.delete(directory);
		});
		return task;
	}
	collapseAll(): void {
		collapseFileTreeDirectories(this.model, this.paths(this.directories));
	}

	async refresh(): Promise<void> {
		const epoch = ++this.epoch;
		this.pending.clear();
		try {
			const rootEntries = await this.list(this.root);
			if (!this.running || this.epoch !== epoch) return;
			this.validate("", rootEntries);
			const next = new Map<string, RemoteTreeEntry[]>([["", rootEntries]]);
			const prefix = this.root === "/" ? "/" : `${this.root}/`;
			const directories = [...this.directories.keys()].filter(Boolean);
			const depths = [
				...new Set(directories.map((path) => path.split("/").length)),
			].sort((a, b) => a - b);
			for (const depth of depths) {
				const present = directories.filter((directory) => {
					if (directory.split("/").length !== depth) return false;
					const parent = directory.includes("/")
						? directory.slice(0, directory.lastIndexOf("/"))
						: "";
					return next
						.get(parent)
						?.some(
							(entry) =>
								entry.kind === "directory" &&
								entry.absolutePath === `${prefix}${directory}`,
						);
				});
				for (let offset = 0; offset < present.length; offset += 16) {
					const results = await Promise.all(
						present.slice(offset, offset + 16).map(async (directory) => {
							const entries = await this.list(this.absolutePath(directory));
							this.validate(directory, entries);
							return [directory, entries] as const;
						}),
					);
					if (!this.running || this.epoch !== epoch) return;
					for (const [directory, entries] of results)
						next.set(directory, entries);
				}
			}
			this.install(next);
		} catch (error) {
			if (this.running && this.epoch === epoch) this.report(error);
		}
	}
}
