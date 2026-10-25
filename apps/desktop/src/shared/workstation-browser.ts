import type { SelectBrowserHistory } from "@superset/local-db/browser-history";
import { z } from "zod";
import type { ForwardedKey } from "./hotkey-chord";
import type { BrowserPreferenceApi } from "./workstation-browser-preferences";
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
		| { type: "navigation-map"; url: string; guestUrl: string }
		| { type: "navigation-error"; message: string }
		| { type: "new-window"; url: string }
		| { type: "context-menu-action"; action: string; url: string }
		| { type: "close-pane" | "reload-pane" | "pane-focus" }
		| { type: "key-forward"; key: ForwardedKey }
		| { type: "agent-active"; active: boolean }
	);

export type WorkstationBrowserNavigationResult =
	| { status: "navigated"; url: string; guestUrl: string }
	| { status: "superseded" };

export const workstationBrowserDeviceEmulationSchema = z
	.object({
		width: z.number().int().min(1).max(8192),
		height: z.number().int().min(1).max(8192),
	})
	.strict()
	.nullable();
export type WorkstationBrowserDeviceEmulation = z.infer<
	typeof workstationBrowserDeviceEmulationSchema
>;

export interface WorkstationBrowserApi {
	setDeviceEmulation?(input: {
		pane: WorkstationBrowserPane;
		params: WorkstationBrowserDeviceEmulation;
	}): Promise<{ status: "requested" | "stale" }>;
	openDevTools?(input: {
		pane: WorkstationBrowserPane;
	}): Promise<{ status: "requested" | "stale" }>;
	reload?(input: {
		pane: WorkstationBrowserPane;
		hard?: boolean;
	}): Promise<{ status: "requested" | "stale" }>;
	preferences?: BrowserPreferenceApi;
	getIcon?(input: {
		pane: WorkstationBrowserPane;
		url: string;
	}): Promise<{ dataUrl: string } | null>;
	navigate?(input: {
		pane: WorkstationBrowserPane;
		url: string;
	}): Promise<WorkstationBrowserNavigationResult>;
	updatePage?(input: {
		pane: WorkstationBrowserPane;
		resourceId: string;
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
