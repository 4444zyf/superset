import type { FileAutoSaveMode } from "@superset/shared/file-settings";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	type AutoSaveDocument,
	FileAutoSaveController,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore/fileAutoSave/fileAutoSave";

export function useRemoteFileAutoSave({
	scope,
	document,
	mode,
}: {
	scope: string;
	document: AutoSaveDocument | null;
	mode: FileAutoSaveMode;
}) {
	const current = useRef(document);
	current.current = document;
	const listeners = useRef(new Set<() => void>());
	const controller = useMemo(
		() =>
			new FileAutoSaveController({
				getDocuments: () =>
					current.current?.id.startsWith(`${scope}:`) ? [current.current] : [],
				subscribeDocuments: (listener) => {
					listeners.current.add(listener);
					return () => {
						listeners.current.delete(listener);
					};
				},
			}),
		[scope],
	);
	useEffect(() => {
		const stop = controller.start();
		const onBlur = () => controller.onWindowChange();
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("blur", onBlur);
			stop();
		};
	}, [controller]);
	useEffect(() => controller.setMode(mode), [controller, mode]);
	useEffect(() => {
		if (current.current !== document) return;
		for (const listener of listeners.current) listener();
	}, [document]);
	return useCallback(() => {
		if (current.current) controller.onFocusChange(current.current);
	}, [controller]);
}
