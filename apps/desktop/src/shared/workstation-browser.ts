import { z } from "zod";
import type { ForwardedKey } from "./hotkey-chord";

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
	register(input: WorkstationBrowserRegistration): Promise<void>;
	unregister(input: WorkstationBrowserPane): Promise<void>;
	onEvent(listener: (event: WorkstationBrowserEvent) => void): () => void;
}
