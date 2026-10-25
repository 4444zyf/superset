import type { SelectBrowserHistory } from "@superset/local-db/browser-history";
import { z } from "zod";
import type { ForwardedKey } from "./hotkey-chord";
import type {
	BrowserPageState,
	WorkspaceViewSnapshotV2,
} from "./workspace-view-v2";

export const workstationBrowserPaneSchema = z.strictObject({
	connectionId: z.string().uuid(),
	generation: z.number().int().positive(),
	workspaceId: z.string().uuid(),
	registrationId: z.string().uuid(),
	paneId: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[\w-]+$/),
});

export const workstationBrowserRegistrationSchema =
	workstationBrowserPaneSchema.extend({
		webContentsId: z.number().int().positive(),
	});

export type WorkstationBrowserPane = z.infer<
	typeof workstationBrowserPaneSchema
>;
export type WorkstationBrowserRegistration = z.infer<
	typeof workstationBrowserRegistrationSchema
>;

export type WorkstationBrowserEvent = WorkstationBrowserPane &
	(
		| { type: "new-window"; url: string }
		| { type: "context-menu-action"; action: string; url: string }
		| { type: "close-pane" | "reload-pane" | "pane-focus" }
		| { type: "key-forward"; key: ForwardedKey }
		| { type: "agent-active"; active: boolean }
	);

export interface WorkstationBrowserApi {
	updatePage?(input: {
		pane: WorkstationBrowserPane;
		state: BrowserPageState;
	}): Promise<
		| { status: "saved" | "unchanged"; snapshot: WorkspaceViewSnapshotV2 }
		| { status: "stale" }
	>;
	history?: {
		getAll(): Promise<SelectBrowserHistory[]>;
		search(input: {
			query: string;
			limit?: number;
		}): Promise<SelectBrowserHistory[]>;
		upsert(input: {
			url: string;
			title: string;
			faviconUrl?: string | null;
		}): Promise<void>;
		clear(): Promise<void>;
	};
	register(input: WorkstationBrowserRegistration): Promise<void>;
	unregister(input: WorkstationBrowserPane): Promise<void>;
	onEvent(listener: (event: WorkstationBrowserEvent) => void): () => void;
}
