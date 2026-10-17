import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import type {
	ChatDraftIdentity,
	ChatDraftValue,
} from "../../../../../shared/workstation-chat-drafts";
import { WorkstationChatDraftStore } from "./workstation-chat-drafts";
export const WorkstationChatDraftsContext =
	createContext<WorkstationChatDraftStore | null>(null);
export function useWorkstationChatDraft(
	api: DirectWorkstationApi,
	connection: DirectDescriptor,
	workspaceId: string,
	sessionId: string | null,
) {
	const shared = useContext(WorkstationChatDraftsContext);
	const store = useMemo(
		() => shared ?? new WorkstationChatDraftStore(api),
		[shared, api],
	);
	useEffect(() => {
		void store.start().catch(() => {});
		if (shared) return;
		return () => {
			void store.flush().catch(() => {});
		};
	}, [store, shared]);
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
	const identity: ChatDraftIdentity | null = sessionId
		? {
				connectionId: connection.connectionId,
				backendId: connection.backendId,
				namespaceId: connection.namespaceId,
				workspaceId,
				sessionId,
			}
		: null;
	const value = store.get(identity);
	return {
		value,
		error: store.error,
		discard: async () => {
			if (identity) await store.discard(identity);
		},
		change: (
			next: ChatDraftValue | ((previous: ChatDraftValue) => ChatDraftValue),
		) => {
			if (identity)
				store.change(
					identity,
					typeof next === "function" ? next(store.get(identity)) : next,
				);
		},
	};
}
