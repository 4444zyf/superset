import { z } from "zod";
import type {
	TargetViewV2,
	WorkspaceViewSnapshotV2,
	WorkspaceViewV2Save,
} from "./workspace-view-v2";
import type { DirectDescriptor } from "./direct-workstation";
import {
	type WorkspaceViewSnapshotV3,
	type WorkspaceViewV3Save,
	workspaceViewV3SaveInputSchema,
} from "./workspace-view-v3";

export interface WorkstationBrowserOpenInput {
	descriptor: DirectDescriptor;
	viewIdentity?: Pick<
		TargetViewV2,
		| "connectionId"
		| "targetRevision"
		| "backendId"
		| "namespaceId"
		| "serviceUid"
		| "autoConnect"
	>;
	workspaceId: string;
	projectId: string | null;
	workspaceName: string;
	url: string;
	target: "current-tab" | "new-tab";
	show: boolean;
}
export interface WorkstationBrowserOpenResult {
	paneId: string;
	url: string;
	title: string;
}
export type WorkstationBrowserOpenEvent =
	| {
			type: "open";
			id: string;
			scopeId: string;
			subscriptionId: string;
			input: WorkstationBrowserOpenInput;
	  }
	| { type: "cancel"; id: string; scopeId: string; subscriptionId: string };
export type WorkstationBrowserOpenIdentity = {
	id: string;
	scopeId: string;
	subscriptionId: string;
};
export type WorkstationBrowserOpenReply = WorkstationBrowserOpenIdentity &
	(
		| { ok: true; result: WorkstationBrowserOpenResult }
		| { ok: false; error: string }
	);

export {
	WORKSTATION_BROWSER_OPEN_CHANNEL,
	WORKSTATION_BROWSER_OPEN_AVAILABILITY_CHANNEL,
} from "./workstation-browser-open-channels";
export const browserOpenSubscriptionSchema = z.strictObject({
	subscriptionId: z.string().uuid(),
});
export const browserOpenScopeSchema = browserOpenSubscriptionSchema.extend({
	scopeId: z.string().uuid(),
});
export const browserOpenIdentitySchema = browserOpenScopeSchema.extend({
	id: z.string().uuid(),
});
export const browserOpenReplySchema = z.discriminatedUnion("ok", [
	browserOpenIdentitySchema.extend({
		ok: z.literal(true),
		result: z.strictObject({
			paneId: z
				.string()
				.min(1)
				.max(128)
				.regex(/^[\w-]+$/),
			url: z
				.string()
				.max(8192)
				.regex(/^[^\u0000-\u001f\u007f]*$/),
			title: z.string().max(4096),
		}),
	}),
	browserOpenIdentitySchema.extend({
		ok: z.literal(false),
		error: z.string().min(1).max(4096),
	}),
]);
export const browserOpenSaveSchema = browserOpenIdentitySchema.extend({
	save: z.strictObject({
		expectedRevision: z.number().int().nonnegative(),
		navigationRevision: z.number().int().nonnegative(),
		view: z.unknown(),
		browserLeases: z
			.array(
				z.strictObject({
					connectionId: z.string().uuid(),
					generation: z.number().int().positive(),
				}),
			)
			.max(10)
			.optional(),
	}),
});
export const browserOpenSaveV3Schema = browserOpenIdentitySchema.extend({
	save: workspaceViewV3SaveInputSchema,
});
export interface WorkstationBrowserOpenAvailability {
	scopeId: string;
	ready: boolean;
	accepting: boolean;
}
export interface WorkstationBrowserOpenApi {
	prepare(input: { subscriptionId: string }): Promise<{ scopeId: string }>;
	confirmReady(input: {
		scopeId: string;
		subscriptionId: string;
	}): Promise<boolean>;
	end(input: { subscriptionId: string }): Promise<void>;
	complete(input: WorkstationBrowserOpenReply): Promise<boolean>;
	isCurrent(input: WorkstationBrowserOpenIdentity): Promise<boolean>;
	saveView(
		input: WorkstationBrowserOpenIdentity & { save: WorkspaceViewV2Save },
	): Promise<WorkspaceViewSnapshotV2>;
	saveViewV3?(
		input: WorkstationBrowserOpenIdentity & { save: WorkspaceViewV3Save },
	): Promise<WorkspaceViewSnapshotV3>;
	onEvent(listener: (event: WorkstationBrowserOpenEvent) => void): () => void;
	onAvailability(
		listener: (event: WorkstationBrowserOpenAvailability) => void,
	): () => void;
}
