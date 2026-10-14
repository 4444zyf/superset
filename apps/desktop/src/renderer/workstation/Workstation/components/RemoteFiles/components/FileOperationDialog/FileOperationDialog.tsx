import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { useEffect, useId, useRef, useState } from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../../../shared/direct-workstation";

export type FileOperation =
	| { kind: "newFile" | "newFolder" }
	| { kind: "rename" | "move" | "copy" | "delete"; absolutePath: string };

function workspacePath(root: string, value: string): string | null {
	if (!root.startsWith("/") || !value.trim() || /[\0\r\n]/.test(value))
		return null;
	const parts: string[] = [];
	for (const part of (value.startsWith("/") ? value : `${root}/${value}`).split(
		"/",
	)) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	const path = `/${parts.join("/")}`;
	return path !== root &&
		(root === "/" || path.startsWith(`${root.replace(/\/$/, "")}/`))
		? path
		: null;
}

export function FileOperationDialog({
	api,
	connection,
	workspaceId,
	root,
	directory,
	operation,
	onClose,
	onComplete,
	onError,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	workspaceId: string;
	root: string;
	directory: string;
	operation: FileOperation;
	onClose(): void;
	onComplete(absolutePath: string): void | Promise<void>;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	const initialValue =
		"absolutePath" in operation
			? operation.kind === "rename"
				? (operation.absolutePath.split("/").at(-1) ?? "")
				: operation.absolutePath
			: "";
	const [value, setValue] = useState(initialValue);
	const fieldId = useId();
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const scope = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		workspaceId,
		root,
		directory,
		operation,
	]);
	const inputOwner = useRef(scope);
	const currentScope = useRef(scope);
	currentScope.current = scope;
	useEffect(() => {
		if (inputOwner.current === scope) return;
		inputOwner.current = scope;
		setValue(initialValue);
		setBusy(false);
		busyRef.current = false;
	}, [scope, initialValue]);
	const creating =
		operation.kind === "newFile" || operation.kind === "newFolder";
	const naming = creating || operation.kind === "rename";
	const deleting = operation.kind === "delete";
	const label = creating
		? t({ message: "Create" })
		: operation.kind === "rename"
			? t({ message: "Rename" })
			: operation.kind === "copy"
				? t({ message: "Copy" })
				: deleting
					? t({ message: "Delete permanently" })
					: t({ message: "Move" });
	const title =
		operation.kind === "newFile"
			? t({ message: "New File..." })
			: operation.kind === "newFolder"
				? t({ message: "New Folder..." })
				: label;
	const submit = async () => {
		if (busyRef.current || connection.capabilities?.workstationFilesV1 !== true)
			return;
		const epoch = scope;
		try {
			if (
				naming &&
				(!value.trim() ||
					value === "." ||
					value === ".." ||
					/[/\\\0\r\n]/.test(value))
			)
				throw new Error(t({ message: "Choose a path inside this workspace." }));
			const source =
				"absolutePath" in operation
					? workspacePath(root, operation.absolutePath)
					: undefined;
			const parent =
				operation.kind === "rename"
					? operation.absolutePath.slice(
							0,
							operation.absolutePath.lastIndexOf("/"),
						)
					: directory;
			const destination = deleting
				? source
				: workspacePath(root, naming ? `${parent}/${value}` : value);
			if (!destination || ("absolutePath" in operation && !source))
				throw new Error(t({ message: "Choose a path inside this workspace." }));
			busyRef.current = true;
			setBusy(true);
			const path =
				operation.kind === "newFile"
					? "filesystem.writeFile"
					: operation.kind === "newFolder"
						? "filesystem.createDirectory"
						: deleting
							? "filesystem.deletePath"
							: operation.kind === "copy"
								? "filesystem.copyPath"
								: "filesystem.movePath";
			const input =
				operation.kind === "newFile"
					? {
							workspaceId,
							absolutePath: destination,
							content: "",
							options: { create: true, overwrite: false },
						}
					: operation.kind === "newFolder"
						? { workspaceId, absolutePath: destination, recursive: false }
						: deleting
							? { workspaceId, absolutePath: source, permanent: true }
							: {
									workspaceId,
									sourceAbsolutePath: source,
									destinationAbsolutePath: destination,
								};
			const result = await api.rpc<{ ok?: boolean }>({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type: "mutation",
				input,
			});
			if (currentScope.current !== epoch) return;
			if (result?.ok === false)
				throw new Error(
					t({ message: "A file or folder with this name already exists." }),
				);
			await onComplete(destination);
			if (currentScope.current === epoch) onClose();
		} catch (error) {
			if (currentScope.current === epoch)
				onError(error instanceof Error ? error.message : String(error));
		} finally {
			if (currentScope.current === epoch) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busyRef.current) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						{deleting
							? t({
									message:
										"This permanently deletes the selected path and its contents.",
								})
							: directory}
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
					className="space-y-4"
				>
					{deleting ? (
						<code className="block break-all text-sm">
							{operation.absolutePath}
						</code>
					) : (
						<label className="grid gap-2 text-sm" htmlFor={fieldId}>
							{naming ? <Trans>Name</Trans> : <Trans>Path</Trans>}
							<Input
								id={fieldId}
								aria-label={
									naming ? t({ message: "Name" }) : t({ message: "Path" })
								}
								value={value}
								maxLength={naming ? 255 : 4096}
								autoFocus
								disabled={busy}
								onChange={(e) => setValue(e.target.value)}
							/>
						</label>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							type="submit"
							variant={deleting ? "destructive" : "default"}
							disabled={
								busy ||
								connection.capabilities?.workstationFilesV1 !== true ||
								(!deleting && !value.trim())
							}
						>
							{label}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
