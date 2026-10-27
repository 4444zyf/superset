import type { DirectDescriptor } from "./direct-workstation";

export interface WorkstationBrowserOpenInput {
	descriptor: DirectDescriptor;
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
