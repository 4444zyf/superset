import { createHash } from "node:crypto";
import { z } from "zod";
import type {
	DirectDescriptor,
	DirectRpc,
} from "../../../shared/direct-workstation";
import { workspaceProcedures } from "../../../shared/workstation-procedures";
import type { OperationIntents } from "./operation-intents";

interface WorkstationManager {
	getVerifiedDescription?(id: string): Record<string, unknown>;
	getLease(id: string): (DirectDescriptor & { url: string }) | null;
	invoke(
		id: string,
		request: { path: string; type: "query" | "mutation"; input?: unknown },
	): Promise<unknown>;
	request(
		id: string,
		request: {
			path: string;
			method?: string;
			body?: string;
			headers?: Record<string, string>;
		},
	): Promise<Response>;
	disconnect(id: string): Promise<void> | void;
	dispose(): Promise<void> | void;
}

const procedures: Record<string, "query" | "mutation"> = {
	"filesystem.browseHost": "query",
	"filesystem.listDirectory": "query",
	"filesystem.readFile": "query",
	"filesystem.writeFile": "mutation",
	"git.getStatus": "query",
	"git.getDiff": "query",
	"workspace.get": "query",
	"workspace.restoreResources": "query",
	"project.list": "query",
	"project.create": "mutation",
	"workspace.list": "query",
	"workspaces.create": "mutation",
	"workspaces.createSession": "mutation",
	"terminal.list": "query",
	"terminal.createSession": "mutation",
	"terminal.launchSession": "mutation",
	"chat.createSession": "mutation",
	"chat.prompt": "mutation",
	"chat.respondToApproval": "mutation",
	"chat.cancelTurn": "mutation",
	"chat.closeSession": "mutation",
	"chat.listSessions": "query",
	"chat.getSession": "query",
	"chat.getItems": "query",
};

function canonicalInput(input: unknown): string {
	if (Array.isArray(input)) return `[${input.map(canonicalInput).join(",")}]`;
	if (input && typeof input === "object")
		return `{${Object.entries(input)
			.filter(([, value]) => value !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, value]) => `${JSON.stringify(key)}:${canonicalInput(value)}`)
			.join(",")}}`;
	return JSON.stringify(input) ?? "null";
}

export class WorkstationController {
	private readonly inFlight = new Set<string>();
	constructor(
		private readonly manager: WorkstationManager,
		private readonly intents?: OperationIntents,
	) {}

	describe(id: string): DirectDescriptor {
		const lease = this.manager.getLease(id);
		if (!lease) throw new Error("Connection is disconnected");
		const { connectionId, generation, backendId, namespaceId, instanceId } =
			lease;
		return { connectionId, generation, backendId, namespaceId, instanceId };
	}

	async features(
		id: string,
		refresh = false,
	): Promise<Pick<DirectDescriptor, "capabilities" | "chatHarnesses">> {
		const connection = this.describe(id);
		let description = refresh
			? undefined
			: this.manager.getVerifiedDescription?.(id);
		if (!description) {
			const response = await this.manager.request(id, {
				path: "/direct/describe",
			});
			if (!response.ok) throw new Error("Could not read backend capabilities");
			description = await response.json();
		}
		const metadata = description as {
			backendId?: string;
			namespaceId?: string;
			serviceUid?: number;
			capabilities?: Record<string, unknown>;
			chatHarnesses?: { id: string; available: boolean; reason?: string }[];
		};
		this.assertGeneration(id, connection.generation);
		if (metadata.capabilities?.workspaceViewRestoreV1 === true) {
			const verified = this.manager.getVerifiedDescription?.(id) as
				| { serviceUid?: number }
				| undefined;
			if (
				metadata.backendId !== connection.backendId ||
				metadata.namespaceId !== connection.namespaceId ||
				(verified?.serviceUid !== undefined &&
					metadata.serviceUid !== verified.serviceUid)
			)
				throw new Error("Backend identity changed; reconnect before restoring");
		}
		const capabilities = Object.fromEntries(
			[
				"projects",
				"sessions",
				"terminals",
				"chat",
				"files",
				"attachments",
				"workstationChatAttachmentInputV1",
				"git",
				"durableOperations",
				"workspaceViewRestoreV1",
				"workstationFilesV1",
				"workstationGitV1",
				"workstationGitIdentityV1",
				"workstationGitHistoryV1",
				"workstationGitSyncV1",
				"workstationManagedWorktreesV1",
				"workstationProjectsV1",
				"workstationProjectScriptsV1",
				"workstationWorkspaceRunV1",
				"workstationWorkspaceCleanupV1",
				"workstationWorkspaceSetupV1",
			].map((key) => [key, metadata.capabilities?.[key] === true]),
		);
		const chatHarnesses = Array.isArray(metadata.chatHarnesses)
			? metadata.chatHarnesses
					.filter((harness) => ["codex", "claude-code"].includes(harness.id))
					.map((harness) => ({
						id: harness.id,
						available: harness.available === true,
						...(typeof harness.reason === "string"
							? { reason: harness.reason }
							: {}),
					}))
			: [];
		return { capabilities, chatHarnesses };
	}

	assertGeneration(id: string, generation: number): void {
		if (this.describe(id).generation !== generation)
			throw new Error("Connection changed; reconnect before continuing");
	}

	async invoke(request: DirectRpc): Promise<unknown> {
		this.assertGeneration(request.connectionId, request.generation);
		const workspaceProcedure = Object.hasOwn(workspaceProcedures, request.path)
			? workspaceProcedures[request.path]
			: undefined;
		if ((workspaceProcedure?.type ?? procedures[request.path]) !== request.type)
			throw new Error("Unsupported workstation procedure");
		if (workspaceProcedure) {
			const identity = workspaceProcedure.identity ?? "workspaceId";
			const input = request.input as Record<string, unknown> | undefined;
			if (typeof input?.[identity] !== "string" || !input[identity].trim())
				throw new Error(
					identity === "projectId"
						? "An explicit project is required"
						: "An explicit workspace is required",
				);
			const features = await this.features(request.connectionId);
			this.assertGeneration(request.connectionId, request.generation);
			if (!features.capabilities?.[workspaceProcedure.capability])
				throw new Error(
					"This backend does not support the required capability",
				);
		}
		const durableProcedure = (
			{
				"workspaces.createSession": "workspaceCreation.createSession",
				"workspaces.create": "workspaces.create",
				"project.create": "project.create",
				"terminal.createSession": "terminal.createSession",
				"terminal.launchSession": "terminal.createSession",
				"chat.createSession": "chat.createSession",
				"chat.prompt": "chat.prompt",
				"git.commit": "git.commit",
				"git.push": "git.push",
				"git.syncBranchV1": "git.syncBranchV1",
				"workspaceRun.startV1": "workspaceRun.startV1",
				"workspaceCleanup.destroyTrackedV1":
					"workspaceCleanup.destroyTrackedV1",
				"workspaceRun.stopV1": "workspaceRun.stopV1",
			} as Record<string, string>
		)[request.path];
		if (
			request.path === "git.commit" ||
			request.path === "git.push" ||
			request.path === "git.syncBranchV1" ||
			request.path === "workspaceRun.startV1" ||
			request.path === "workspaceRun.stopV1" ||
			request.path === "workspaceCleanup.destroyTrackedV1"
		) {
			const features = await this.features(request.connectionId);
			this.assertGeneration(request.connectionId, request.generation);
			if (!this.intents || !features.capabilities?.durableOperations)
				throw new Error("Durable operation tracking is required");
		}
		if (request.type === "mutation" && durableProcedure && this.intents) {
			const input = request.input as Record<string, unknown>;
			if (
				request.path === "terminal.launchSession" &&
				(typeof input?.initialCommand !== "string" ||
					!input.initialCommand.trim())
			)
				throw new Error("An initial command is required");
			const parsedOperationId = z
				.string()
				.uuid()
				.safeParse(input?.operationId ?? input?.commandId);
			if (!parsedOperationId.success)
				throw new Error("A stable operation ID is required");
			const operationId = parsedOperationId.data;
			const { operationId: _operationId, ...parameters } = input;
			const connection = this.describe(request.connectionId);
			this.intents.begin({
				connectionId: request.connectionId,
				backendId: connection.backendId,
				namespaceId: connection.namespaceId,
				operationId,
				procedure: durableProcedure,
				inputHash: createHash("sha256")
					.update(canonicalInput(parameters))
					.digest("hex"),
			});
			this.inFlight.add(operationId);
			try {
				const response = (await this.manager.invoke(request.connectionId, {
					path: "direct.execute",
					type: "mutation",
					input: {
						operationId,
						procedure: durableProcedure,
						input: parameters,
					},
				})) as { status: string; result: unknown };
				this.assertGeneration(request.connectionId, request.generation);
				if (response.status !== "completed")
					throw new Error("Operation is pending; reconcile before continuing");
				this.intents.resolve(request.connectionId, operationId);
				return response.result;
			} finally {
				this.inFlight.delete(operationId);
			}
		}
		if (!request.path.startsWith("chat.")) {
			const result = await this.manager.invoke(request.connectionId, request);
			this.assertGeneration(request.connectionId, request.generation);
			return result;
		}
		const procedure = request.path.slice(5);
		const input = JSON.stringify(request.input ?? {});
		const response = await this.manager.request(request.connectionId, {
			path: `/chat-v3/trpc/${procedure}${request.type === "query" ? `?input=${encodeURIComponent(input)}` : ""}`,
			method: request.type === "query" ? "GET" : "POST",
			...(request.type === "mutation"
				? { body: input, headers: { "Content-Type": "application/json" } }
				: {}),
		});
		const envelope = (await response.json()) as {
			error?: { message?: string };
			result?: { data: unknown };
		};
		this.assertGeneration(request.connectionId, request.generation);
		if (!response.ok || envelope.error)
			throw new Error(envelope.error?.message ?? "Chat request failed");
		if (!envelope.result) throw new Error("Invalid chat response");
		return envelope.result.data;
	}

	listPending(connectionId: string) {
		return this.intents?.list(connectionId) ?? [];
	}

	async inspectPending(connectionId: string): Promise<unknown[]> {
		const connection = this.describe(connectionId);
		const result: unknown[] = [];
		for (const operation of this.listPending(connectionId)) {
			if (
				operation.backendId !== connection.backendId ||
				operation.namespaceId !== connection.namespaceId
			)
				throw new Error(
					"Reconnect to the original backend to inspect this operation",
				);
			const status = (await this.manager.invoke(connectionId, {
				path: "direct.operationStatus",
				type: "query",
				input: { operationId: operation.operationId },
			})) as { status: string } | null;
			this.assertGeneration(connectionId, connection.generation);
			result.push({
				operationId: operation.operationId,
				procedure: operation.procedure,
				...(status ?? { status: "not_received" }),
			});
		}
		return result;
	}
	async reconcile(connectionId: string): Promise<unknown[]> {
		const connection = this.describe(connectionId);
		const result: unknown[] = [];
		for (const operation of this.listPending(connectionId)) {
			if (this.inFlight.has(operation.operationId))
				throw new Error("The operation is still awaiting a response");
			if (
				operation.backendId !== connection.backendId ||
				operation.namespaceId !== connection.namespaceId
			)
				throw new Error(
					"Reconnect to the original backend to reconcile this operation",
				);
			const status = (await this.manager.invoke(connectionId, {
				path: "direct.operationStatus",
				type: "query",
				input: { operationId: operation.operationId },
			})) as { status: string } | null;
			this.assertGeneration(connectionId, connection.generation);
			result.push({
				operationId: operation.operationId,
				procedure: operation.procedure,
				...(status ?? { status: "not_received" }),
			});
			if (
				!status ||
				status.status === "completed" ||
				status.status === "failed"
			)
				this.intents?.resolve(connectionId, operation.operationId);
		}
		return result;
	}

	async acknowledge(
		connectionId: string,
		generation: number,
		operationId: string,
	): Promise<void> {
		this.assertGeneration(connectionId, generation);
		const connection = this.describe(connectionId);
		const operation = this.listPending(connectionId).find(
			(candidate) => candidate.operationId === operationId,
		);
		if (
			!operation ||
			operation.backendId !== connection.backendId ||
			operation.namespaceId !== connection.namespaceId ||
			this.inFlight.has(operationId)
		)
			throw new Error(
				"The pending action cannot be acknowledged on this connection",
			);
		const status = (await this.manager.invoke(connectionId, {
			path: "direct.operationStatus",
			type: "query",
			input: { operationId },
		})) as { status: string } | null;
		this.assertGeneration(connectionId, generation);
		if (status?.status !== "unresolved")
			throw new Error("Check the pending action again before continuing");
		this.intents?.resolve(connectionId, operationId);
	}

	disconnect(id: string) {
		return this.manager.disconnect(id);
	}

	dispose() {
		return this.manager.dispose();
	}
}
