import { useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { useEffect, useRef } from "react";
import type { FileOperation } from "../FileOperationDialog/FileOperationDialog";

import { FileActionItems } from "./components/FileActionItems/FileActionItems";

export function FileActionMenu({
	name,
	absolutePath,
	disabled,
	onOperation,
}: {
	name: string;
	absolutePath: string;
	disabled: boolean;
	onOperation(operation: FileOperation): void;
}) {
	const { t } = useLingui();
	const pending = useRef<FileOperation | null>(null);
	useEffect(
		() => () => {
			pending.current = null;
		},
		[],
	);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					disabled={disabled}
					aria-label={`${t({ message: "File actions" })}: ${name}`}
				>
					<MoreVertical className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				onCloseAutoFocus={(event) => {
					const operation = pending.current;
					pending.current = null;
					if (!operation) return;
					event.preventDefault();
					onOperation(operation);
				}}
			>
				<FileActionItems
					absolutePath={absolutePath}
					onChoose={(operation) => {
						pending.current = operation;
					}}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
