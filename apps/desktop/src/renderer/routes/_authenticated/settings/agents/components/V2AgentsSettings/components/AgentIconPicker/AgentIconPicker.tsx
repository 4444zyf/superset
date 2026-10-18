import { electronTrpc } from "renderer/lib/electron-trpc";
import { AgentIcon } from "../AgentIcon";
import {
	type AgentIconPickerProps,
	AgentIconPickerView,
} from "./components/AgentIconPickerView/AgentIconPickerView";
export function AgentIconPicker(props: AgentIconPickerProps) {
	const selectImage = electronTrpc.window.selectImageFile.useMutation();
	return (
		<AgentIconPickerView
			{...props}
			renderIcon={(p) => <AgentIcon {...p} />}
			selectImage={() => selectImage.mutateAsync()}
		/>
	);
}
