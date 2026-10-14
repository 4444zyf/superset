import { Trans } from "@lingui/react/macro";
import { DropdownMenuItem } from "@superset/ui/dropdown-menu";
import type { FileOperation } from "../../../FileOperationDialog/FileOperationDialog";
export function FileActionItems({
	absolutePath,
	disabled,
	onChoose,
}: {
	absolutePath: string;
	disabled?: boolean;
	onChoose(operation: FileOperation): void;
}) {
	return (
		<>
			<DropdownMenuItem
				disabled={disabled}
				data-file-action="rename"
				onSelect={() => {
					onChoose({ kind: "rename", absolutePath });
				}}
			>
				<Trans>Rename</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={disabled}
				data-file-action="move"
				onSelect={() => {
					onChoose({ kind: "move", absolutePath });
				}}
			>
				<Trans>Move</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={disabled}
				data-file-action="copy"
				onSelect={() => {
					onChoose({ kind: "copy", absolutePath });
				}}
			>
				<Trans>Copy</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={disabled}
				data-file-action="delete"
				variant="destructive"
				onSelect={() => {
					onChoose({ kind: "delete", absolutePath });
				}}
			>
				<Trans>Delete permanently</Trans>
			</DropdownMenuItem>
		</>
	);
}
