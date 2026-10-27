import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { privateSocketFetch } from "@superset/direct-connection/private-socket";
import { readPrivateBackendFile } from "@superset/direct-install/health";
import type { AppRouter } from "@superset/host-service/trpc";
import { directConfigSchema } from "@superset/shared/direct-backend-config";
import { directBackendSocketPath } from "@superset/shared/direct-backend-socket";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

const origin = "http://superset-remix.invalid";
const readProcedures = new Map([
	["direct.browserImportSourcesV1", "workstationBrowserImportSourcesV1"],
	["direct.operationStatus", "durableOperations"],
	["direct.browserCaptureV1", "workstationBrowserCaptureV1"],
	["direct.browserReadV1", "workstationBrowserReadBridgeV1"],
	["settings.agentConfigs.readCatalogV1", "workstationAgentCatalogReadV1"],
	["project.list", "projects"],
	["workspace.list", "sessions"],
	["terminal.list", "terminals"],
	["terminal.snapshot", "terminals"],
	[
		"settings.terminalPresets.catalogWithRevisionV1",
		"workstationTerminalScriptsV1",
	],
]);
export interface NamespaceDescription {
	backendId: string;
	namespaceId: string;
	instanceId: string;
	serviceUid: number;
	runtimeMode: "direct";
	protocolVersion: 1;
	socketPath: string;
	capabilities: Record<string, unknown>;
}

export async function resolveDirectNamespace(input: string) {
	return resolveNamespace(input, false);
}

export async function resolveBrowserNavigationNamespace(input: string) {
	return resolveNamespace(input, true);
}

export async function resolveBrowserEvaluationNamespace(input: string) {
	return resolveNamespace(input, false, true);
}

export async function resolveBrowserOpenNamespace(input: string) {
	return resolveNamespace(input, false, false, true);
}

export async function resolveBrowserImportNamespace(input: string) {
	return resolveNamespace(input, false, false, false, true);
}

async function resolveNamespace(
	input: string,
	allowNavigation: boolean,
	allowEvaluation = false,
	allowOpen = false,
	allowImport = false,
) {
	const uid = process.getuid?.();
	if (uid === undefined || uid < 1)
		throw new Error(
			"Namespace access requires the ordinary backend service user",
		);
	if (
		!isAbsolute(input) ||
		input.length > 32768 ||
		Array.from(input).some((character) => character.charCodeAt(0) < 32)
	)
		throw new Error("An absolute namespace directory is required");
	const homeDir = resolve(input);
	for (const directory of [
		homeDir,
		join(homeDir, "state"),
		join(homeDir, "credentials"),
	]) {
		const stat = lstatSync(directory);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			stat.uid !== uid ||
			(stat.mode & 0o077) !== 0
		)
			throw new Error(
				"Namespace directories must be private and owned by the service user",
			);
	}
	const config = directConfigSchema.parse(
		JSON.parse(
			readPrivateBackendFile(join(homeDir, "service-config.json"), 65536),
		),
	);
	if (
		config.homeDir !== homeDir ||
		config.secretFile !== join(homeDir, "credentials/host-secret")
	)
		throw new Error(
			"Namespace configuration identity does not match its directory",
		);
	const identity = JSON.parse(
		readPrivateBackendFile(join(homeDir, "identity.json"), 65536),
	);
	if (
		identity.backendId !== config.backendId ||
		identity.namespaceId !== config.namespaceId
	)
		throw new Error("Namespace identity does not match its configuration");
	for (const marker of ["disabled", "legacy-import.lock"]) {
		try {
			readPrivateBackendFile(join(homeDir, "state", marker), 65536);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		throw new Error("The namespace is stopped or unavailable");
	}
	const socketPath = directBackendSocketPath({ ...config, uid });
	const readEndpoint = () => {
		const row = JSON.parse(
			readPrivateBackendFile(join(homeDir, "state/endpoint.json"), 65536),
		);
		if (
			row.backendId !== config.backendId ||
			row.namespaceId !== config.namespaceId ||
			row.serviceUid !== uid ||
			row.runtimeMode !== "direct" ||
			row.protocolVersion !== 1 ||
			row.socketPath !== socketPath ||
			typeof row.instanceId !== "string" ||
			!row.instanceId ||
			row.instanceId.length > 128 ||
			!Number.isInteger(row.port) ||
			row.port < 1 ||
			row.port > 65535
		)
			throw new Error(
				"Namespace endpoint identity does not match its configuration",
			);
		return row as {
			backendId: string;
			namespaceId: string;
			instanceId: string;
			serviceUid: number;
			runtimeMode: "direct";
			protocolVersion: 1;
			socketPath: string;
			port: number;
		};
	};
	const endpoint = readEndpoint();
	const secret = readPrivateBackendFile(config.secretFile, 1024).trim();
	if (!/^[a-f0-9]{64}$/.test(secret))
		throw new Error("Invalid namespace credentials");
	const request = async (path: string, init: RequestInit = {}) => {
		if (readEndpoint().instanceId !== endpoint.instanceId)
			throw new Error("Namespace backend changed; choose the target again");
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${secret}`);
		return privateSocketFetch(socketPath, path, {
			...init,
			headers,
			redirect: "error",
			signal: init.signal ?? AbortSignal.timeout(5000),
		});
	};
	const response = await request("/direct/describe");
	if (!response.ok)
		throw new Error("Could not authenticate the selected namespace");
	const description = (await response.json()) as NamespaceDescription;
	for (const field of [
		"backendId",
		"namespaceId",
		"instanceId",
		"serviceUid",
		"runtimeMode",
		"protocolVersion",
		"socketPath",
	] as const)
		if (description[field] !== endpoint[field])
			throw new Error("Authenticated namespace identity changed");
	if (!description.capabilities || typeof description.capabilities !== "object")
		throw new Error("Namespace capabilities are unavailable");
	const client = createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: origin + "/trpc",
				transformer: SuperJSON,
				fetch: (async (input: string | URL | Request, init?: RequestInit) => {
					const url = new URL(
						typeof input === "string"
							? input
							: input instanceof URL
								? input.href
								: input.url,
					);
					const procedures = decodeURIComponent(
						url.pathname.slice("/trpc/".length),
					).split(",");
					const navigation =
						allowNavigation &&
						(init?.method ?? "GET") === "POST" &&
						procedures.length === 1 &&
						procedures[0] === "direct.browserNavigateV1";
					const evaluation =
						allowEvaluation &&
						(init?.method ?? "GET") === "POST" &&
						procedures.length === 1 &&
						procedures[0] === "direct.browserEvaluateV1";
					const opening =
						allowOpen &&
						(init?.method ?? "GET") === "POST" &&
						procedures.length === 1 &&
						procedures[0] === "direct.browserOpenV1";
					const importing =
						allowImport &&
						(init?.method ?? "GET") === "POST" &&
						procedures.length === 1 &&
						procedures[0] === "direct.browserImportCookiesV1";
					if (
						url.origin !== origin ||
						!url.pathname.startsWith("/trpc/") ||
						(!navigation &&
							!evaluation &&
							!opening &&
							!importing &&
							((init?.method ?? "GET") !== "GET" ||
								procedures.some((path) => !readProcedures.has(path))))
					)
						throw new Error("Only read-only namespace procedures are allowed");
					if (importing) {
						if (
							description.capabilities.durableOperations !== true ||
							description.capabilities.workstationBrowserCookieImportV1 !== true
						)
							throw Error(
								"This backend does not support the required browser-import capability",
							);
						const timeout = AbortSignal.timeout(20_000);
						return request(url.pathname + url.search, {
							...init,
							signal: init?.signal
								? AbortSignal.any([init.signal, timeout])
								: timeout,
						} as RequestInit);
					}
					if (opening) {
						if (
							description.capabilities.durableOperations !== true ||
							description.capabilities.workstationBrowserOpenV1 !== true
						)
							throw Error(
								"This backend does not support the required browser-open capability",
							);
						const timeout = AbortSignal.timeout(20_000);
						return request(url.pathname + url.search, {
							...init,
							signal: init?.signal
								? AbortSignal.any([init.signal, timeout])
								: timeout,
						} as RequestInit);
					}
					if (navigation) {
						if (
							description.capabilities.durableOperations !== true ||
							description.capabilities.workstationBrowserNavigationV1 !== true
						)
							throw new Error(
								"This backend does not support the required navigation capability",
							);
						const timeout = AbortSignal.timeout(20_000);
						return request(url.pathname + url.search, {
							...init,
							signal: init?.signal
								? AbortSignal.any([init.signal, timeout])
								: timeout,
						} as RequestInit);
					}
					if (evaluation) {
						if (
							description.capabilities.durableOperations !== true ||
							description.capabilities.workstationBrowserEvaluationV1 !== true
						)
							throw new Error(
								"This backend does not support the required evaluation capability",
							);
						const timeout = AbortSignal.timeout(20_000);
						return request(url.pathname + url.search, {
							...init,
							signal: init?.signal
								? AbortSignal.any([init.signal, timeout])
								: timeout,
						} as RequestInit);
					}
					if (
						procedures.some(
							(path) =>
								description.capabilities[readProcedures.get(path)!] !== true,
						)
					)
						throw new Error(
							"This backend does not support the required read capability",
						);
					if (procedures.includes("direct.browserCaptureV1")) {
						const timeout = AbortSignal.timeout(20_000);
						return request(url.pathname + url.search, {
							...init,
							signal: init?.signal
								? AbortSignal.any([init.signal, timeout])
								: timeout,
						} as RequestInit);
					}
					return request(url.pathname + url.search, init as RequestInit);
				}) as NonNullable<Parameters<typeof httpBatchLink>[0]["fetch"]>,
			}),
		],
	});
	return { description, client };
}
