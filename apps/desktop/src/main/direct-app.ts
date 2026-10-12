import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { msg } from "@lingui/core/macro";
import {
	ConnectionRegistry,
	DirectConnectionManager,
	DirectPortForwardManager,
	localConnectionId,
	type RemoteTransport,
	validateProfile,
} from "@superset/direct-connection";
import {
	controlRemoteBackend,
	installRemoteBackend,
	probeRemoteBackend,
} from "@superset/direct-install";
import { i18n, initI18nAsync } from "@superset/i18n";
import { resolveLocale } from "@superset/i18n/locales";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { z } from "zod";
import {
	DIRECT_CHANNEL,
	DIRECT_CONNECTION_CHANNEL,
	DIRECT_SOCKET_CHANNEL,
} from "../shared/direct-workstation";
import { AutomaticReconnect } from "./lib/ssh-direct/automatic-reconnect";
import { runConfirmedRemoteControl } from "./lib/ssh-direct/confirmed-remote-control";
import { importSelectedLocalData } from "./lib/ssh-direct/import-local-data";
import { createLocalBackend } from "./lib/ssh-direct/local-backend";
import { LocalDataController } from "./lib/ssh-direct/local-data-controller";
import { OperationIntents } from "./lib/ssh-direct/operation-intents";
import {
	readRemoteAttachment,
	uploadSelectedAttachment,
} from "./lib/ssh-direct/remote-files";
import { readSelectedAttachmentBytes } from "./lib/ssh-direct/selected-attachment";
import { SocketBroker } from "./lib/ssh-direct/socket-broker";
import { closeWindowTransports } from "./lib/ssh-direct/window-transports";
import { WorkstationController } from "./lib/ssh-direct/workstation-controller";

const profileSchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().trim().min(1).max(100),
		host: z.string().trim().min(1).max(255),
		port: z.number().int().min(1).max(65535).optional(),
		user: z.string().max(100).optional(),
		identityFile: z.string().max(4096).optional(),
	})
	.strict();
const rpcSchema = z
	.object({
		connectionId: z.string().uuid(),
		generation: z.number().int().positive(),
		path: z.string().max(100),
		type: z.enum(["query", "mutation"]),
		input: z.unknown().optional(),
	})
	.strict();

export async function startWorkstation(): Promise<void> {
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	await app.whenReady();
	await initI18nAsync(resolveLocale(app.getPreferredSystemLanguages()));
	const dataDir = path.join(app.getPath("userData"), "direct-workstation");
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	const registry = new ConnectionRegistry(path.join(dataDir, "connections.db"));
	const intents = new OperationIntents(
		path.join(dataDir, "operation-intents.db"),
	);
	const selectedReleases = new Map<string, string>();
	const passwords = new Map<string, string>();
	const automaticConnections = new Set<string>();
	const resourcesRoot = app.isPackaged
		? path.join(process.resourcesPath, "resources")
		: path.join(__dirname, "../resources");
	if (!registry.get(localConnectionId))
		registry.save({
			id: localConnectionId,
			kind: "local",
			name: "Local Device",
			host: "localhost",
		});
	const local = createLocalBackend({
		dataDir: path.join(dataDir, "local-backend"),
		execPath: process.execPath,
		supervisorPath: path.join(__dirname, "direct-supervisor.js"),
		hostServicePath: path.join(__dirname, "direct-backend.js"),
		migrationsFolder: path.join(resourcesRoot, "host-migrations"),
		chatMigrationsFolder: path.join(resourcesRoot, "chat-migrations"),
	});
	const trustedKeys = () => {
		try {
			return JSON.parse(
				readFileSync(
					path.join(resourcesRoot, "direct-release-keys.json"),
					"utf8",
				),
			) as Record<string, string>;
		} catch {
			throw new Error(
				"This app has no trusted backend release configured. Build a signed release and embed its verification key.",
			);
		}
	};
	const install = async (
		id: string,
		transport: RemoteTransport,
		password?: string,
	) => {
		const probe = await probeRemoteBackend(transport);
		return installRemoteBackend({
			transport,
			releaseRoot:
				selectedReleases.get(id) ??
				path.join(resourcesRoot, "direct-backend", probe.target),
			trustedKeys: trustedKeys(),
			...(password ? { password } : {}),
		});
	};
	const manager = new DirectConnectionManager({
		registry,
		local,
		install: async (profile, transport) => {
			if (automaticConnections.has(profile.id))
				throw new Error(
					"The backend is unavailable. Connect explicitly to install or start it.",
				);
			await install(profile.id, transport, passwords.get(profile.id));
		},
	});
	const controller = new WorkstationController(manager, intents);
	const sockets = new SocketBroker((id, socketPath) =>
		manager.openSocket(id, socketPath),
	);
	const forwards = new DirectPortForwardManager(manager);
	let window: BrowserWindow | null = null;
	let quitting = false;
	const reconnect = new AutomaticReconnect({
		getStatus: (id) => manager.getStatus(id),
		connect: async (id) => {
			sockets.closeConnection(id);
			forwards.closeConnection(id);
			automaticConnections.add(id);
			try {
				await manager.connect(id);
				const descriptor = controller.describe(id);
				const features = await controller.features(id);
				controller.assertGeneration(id, descriptor.generation);
				return { ...descriptor, ...features };
			} finally {
				automaticConnections.delete(id);
			}
		},
		notify: (message) => {
			if (window && !window.webContents.isDestroyed())
				window.webContents.send(DIRECT_CONNECTION_CHANNEL, message);
		},
	});
	const createWindow = () => {
		window = new BrowserWindow({
			width: 1280,
			height: 850,
			minWidth: 800,
			minHeight: 600,
			title: "Superset",
			backgroundColor: "#09090b",
			titleBarStyle: "hiddenInset",
			webPreferences: {
				preload: path.join(__dirname, "../preload/index.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		const owner = window.webContents.id;
		window.on("closed", () => {
			if (!quitting) {
				reconnect.dispose();
				const ids = registry.list().map((profile) => profile.id);
				closeWindowTransports(owner, ids, { sockets, forwards });
				for (const id of ids) manager.disconnect(id);
			}
			window = null;
		});
		if (process.env.ELECTRON_RENDERER_URL)
			void window.loadURL(process.env.ELECTRON_RENDERER_URL);
		else void window.loadFile(path.join(__dirname, "../renderer/index.html"));
	};
	const pinLocalNamespace = (namespace: {
		backendId: string;
		namespaceId: string;
	}) => {
		const profile = registry.get(localConnectionId);
		if (!profile) throw new Error("The local connection is missing");
		registry.save({
			...profile,
			backendId: namespace.backendId,
			namespaceId: namespace.namespaceId,
			serviceUid: process.getuid?.(),
		});
	};
	const localData = new LocalDataController({
		local,
		hasPending: () => intents.list(localConnectionId).length > 0,
		disconnect: () => {
			reconnect.disarm(localConnectionId);
			sockets.closeConnection(localConnectionId);
			forwards.closeConnection(localConnectionId);
			manager.disconnect(localConnectionId);
		},
		pin: pinLocalNamespace,
	});
	pinLocalNamespace(localData.capture().namespace);
	const uuid = (value: unknown) => z.string().uuid().parse(value);
	const namespaceLabel = z
		.string()
		.trim()
		.min(1)
		.max(128)
		.regex(/^[^\0\r\n]+$/);
	const sourceId = z.string().regex(/^[a-f0-9]{64}$/);
	const historyPage = z
		.object({
			namespaceId: z.string().uuid(),
			offset: z.number().int().nonnegative().optional(),
			limit: z.number().int().min(1).max(100).optional(),
		})
		.strict();
	const historyChunk = z
		.object({
			namespaceId: z.string().uuid(),
			workspaceId: z.string().uuid(),
			terminalId: z.string().uuid(),
			byteOffset: z.number().int().nonnegative().optional(),
			byteLimit: z.number().int().min(4).max(8192).optional(),
		})
		.strict();
	ipcMain.handle(
		DIRECT_CHANNEL,
		async (event, action: unknown, payload: unknown) => {
			if (
				!window ||
				event.sender !== window.webContents ||
				event.senderFrame !== window.webContents.mainFrame
			)
				throw new Error("Unauthorized workstation caller");
			const callerWindow = window;
			const owner = event.sender.id;
			switch (action) {
				case "localData.list":
					return local.listNamespaces();
				case "localData.create":
					localData.assertAvailable();
					return local.createNamespace(namespaceLabel.parse(payload));
				case "localData.select":
					return localData.selectNamespace(uuid(payload));
				case "localData.remove": {
					const id = uuid(payload);
					const target = local.listNamespaces().find((row) => row.id === id);
					if (!target || target.selected || target.isDefault)
						throw new Error(
							"Only an inactive additional namespace can be removed",
						);
					return localData.runSelected(
						async () => {
							const answer = await dialog.showMessageBox(callerWindow, {
								type: "warning",
								message: i18n._(msg({ message: "Remove" })),
								detail: target.label,
								buttons: [
									i18n._(msg({ message: "Cancel" })),
									i18n._(msg({ message: "Continue" })),
								],
								defaultId: 0,
								cancelId: 0,
							});
							return answer.response === 1;
						},
						async () => local.removeNamespace(id),
						{ disconnect: false },
					);
				}
				case "localData.discover":
					return local.discoverLegacySources();
				case "localData.preview": {
					const ids = z.array(sourceId).min(1).max(32).parse(payload);
					if (new Set(ids).size !== ids.length)
						throw new Error("Select each source once");
					return local.previewLegacySources(ids);
				}
				case "localData.history":
					return local.listLegacyHistory(historyPage.parse(payload));
				case "localData.readHistory":
					return local.readLegacyHistory(historyChunk.parse(payload));
				case "localData.import": {
					const input = z
						.object({ sourceId, label: namespaceLabel.optional() })
						.strict()
						.parse(payload);
					let sourceDirectory: string | undefined;
					return localData.runSelected(
						async () => {
							const source = (await local.discoverLegacySources()).sources.find(
								(row) => row.id === input.sourceId,
							);
							if (!source)
								throw new Error(
									"The selected legacy source is no longer available",
								);
							sourceDirectory = source.sourceDirectory;
							const answer = await dialog.showMessageBox(callerWindow, {
								type: "warning",
								message: i18n._(msg({ message: "Import local data" })),
								detail: source.sourceDirectory,
								buttons: [
									i18n._(msg({ message: "Cancel" })),
									i18n._(msg({ message: "Import" })),
								],
								defaultId: 0,
								cancelId: 0,
							});
							return answer.response === 1;
						},
						async () => {
							const source = (await local.discoverLegacySources()).sources.find(
								(row) => row.id === input.sourceId,
							);
							if (!source || source.sourceDirectory !== sourceDirectory)
								throw new Error("The selected legacy source changed");
							const result = await local.importLocalData(
								source.sourceDirectory,
								{ createNamespace: true, label: input.label },
							);
							return {
								destinationNamespaceId: result.destinationNamespaceId,
								sourceNamespace: result.sourceNamespace,
								targetNamespace: result.targetNamespace,
								projects: result.projects,
								workspaces: result.workspaces,
								terminals: result.terminals,
								chats: result.chats,
								warnings: result.warnings ?? [],
							};
						},
						{ disconnect: false },
					);
				}
				case "list":
					return registry.list();
				case "save": {
					const input = profileSchema.parse(payload);
					if (input.id === localConnectionId)
						throw new Error("The local connection is managed by this app");
					const profile = validateProfile({
						...input,
						...(input.identityFile?.startsWith("~/")
							? {
									identityFile: path.join(
										homedir(),
										input.identityFile.slice(2),
									),
								}
							: {}),
					});
					if (intents.list(profile.id).length)
						throw new Error(
							"Reconcile pending operations before editing this connection",
						);
					reconnect.disarm(profile.id);
					sockets.closeConnection(profile.id);
					forwards.closeConnection(profile.id);
					await manager.disconnect(profile.id);
					return registry.save(profile);
				}
				case "remove": {
					const id = uuid(payload);
					if (id === localConnectionId)
						throw new Error("The local connection is managed by this app");
					if (intents.list(id).length)
						throw new Error(
							"Reconcile pending operations before removing this connection",
						);
					reconnect.disarm(id);
					sockets.closeConnection(id);
					forwards.closeConnection(id);
					await controller.disconnect(id);
					registry.remove(id);
					selectedReleases.delete(id);
					return;
				}
				case "test":
					return manager.test(uuid(payload));
				case "refreshFeatures": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					const features = await controller.features(input.connectionId);
					controller.assertGeneration(input.connectionId, input.generation);
					return { ...controller.describe(input.connectionId), ...features };
				}
				case "listPending":
					return controller.listPending(uuid(payload));
				case "reconcile":
					return controller.reconcile(uuid(payload));
				case "acknowledge": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							operationId: z.string().uuid(),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					const answer = await dialog.showMessageBox(window, {
						type: "warning",
						message: i18n._(
							msg({
								message:
									"After inspecting the remote sessions and files, allow new actions. The previous action remains unresolved on the remote backend.",
							}),
						),
						buttons: [
							i18n._(msg({ message: "Cancel" })),
							i18n._(msg({ message: "Continue" })),
						],
						defaultId: 0,
						cancelId: 0,
					});
					if (answer.response !== 1) return false;
					await controller.acknowledge(
						input.connectionId,
						input.generation,
						input.operationId,
					);
					return true;
				}
				case "disconnect": {
					const id = uuid(payload);
					reconnect.disarm(id);
					sockets.closeConnection(id);
					forwards.closeConnection(id);
					return controller.disconnect(id);
				}
				case "connect": {
					const { id, password } = z
						.object({
							id: z.string().uuid(),
							password: z.string().max(1024).optional(),
						})
						.strict()
						.parse(payload);
					if (id === localConnectionId) localData.assertAvailable();
					reconnect.disarm(id);
					manager.disconnect(id);
					if (password) passwords.set(id, password);
					try {
						sockets.closeConnection(id);
						forwards.closeConnection(id);
						await manager.connect(id);
						const descriptor = controller.describe(id);
						const features = await controller.features(id);
						controller.assertGeneration(id, descriptor.generation);
						const connection = { ...descriptor, ...features };
						reconnect.arm(connection, registry.get(id)?.kind ?? "ssh");
						return connection;
					} finally {
						passwords.delete(id);
					}
				}
				case "control": {
					const input = z
						.object({
							id: z.string().uuid(),
							action: z.enum([
								"install",
								"activate",
								"start",
								"stop",
								"repair",
								"uninstall",
							]),
							password: z.string().max(1024).optional(),
						})
						.strict()
						.parse(payload);
					if (
						input.id === localConnectionId &&
						input.action !== "start" &&
						input.action !== "stop"
					)
						throw new Error("The local backend is updated with this app");
					const confirmControl = async () => {
						if (input.action !== "stop" && input.action !== "uninstall")
							return true;
						const answer = await dialog.showMessageBox(callerWindow, {
							type: "warning",
							message: i18n._(
								msg({
									message:
										"This action stops the selected backend and interrupts active terminals and chats. Data is kept.",
								}),
							),
							buttons: [
								i18n._(msg({ message: "Cancel" })),
								i18n._(msg({ message: "Continue" })),
							],
							defaultId: 0,
							cancelId: 0,
						});
						return answer.response === 1;
					};
					if (input.id === localConnectionId)
						return localData.runSelected(confirmControl, async () =>
							local.control(input.action as "start" | "stop"),
						);
					return runConfirmedRemoteControl({
						getProfile: () => registry.get(input.id),
						confirm: confirmControl,
						control: async () => {
							reconnect.disarm(input.id);
							if (input.action !== "install") {
								sockets.closeConnection(input.id);
								forwards.closeConnection(input.id);
								manager.disconnect(input.id);
							}
							return manager.withRemoteTransport<unknown>(
								input.id,
								(transport) =>
									input.action === "install"
										? install(input.id, transport, input.password)
										: controlRemoteBackend({
												transport,
												trustedKeys: trustedKeys(),
												action: input.action,
												...(input.password ? { password: input.password } : {}),
											}),
							);
						},
					});
				}
				case "openPort": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							workspaceId: z.string().uuid(),
							port: z.number().int().min(1).max(65535),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					const forward = await forwards.open(
						input.connectionId,
						input.workspaceId,
						input.port,
					);
					try {
						controller.assertGeneration(input.connectionId, input.generation);
						await shell.openExternal(forward.url);
						controller.assertGeneration(input.connectionId, input.generation);
						return { id: forward.id, url: forward.url };
					} catch (error) {
						forwards.close(forward.id);
						throw error;
					}
				}
				case "closePort":
					return forwards.close(uuid(payload));
				case "chooseAttachment": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					const selected = await dialog.showOpenDialog(window, {
						properties: ["openFile"],
					});
					if (selected.canceled || !selected.filePaths[0]) return null;
					const file = selected.filePaths[0];
					const bytes = await readSelectedAttachmentBytes(file);
					controller.assertGeneration(input.connectionId, input.generation);
					const mediaTypes: Record<string, string> = {
						".png": "image/png",
						".jpg": "image/jpeg",
						".jpeg": "image/jpeg",
						".gif": "image/gif",
						".webp": "image/webp",
						".pdf": "application/pdf",
						".txt": "text/plain",
						".md": "text/markdown",
						".json": "application/json",
						".csv": "text/csv",
					};
					const attachment = await uploadSelectedAttachment(manager, input, {
						bytes,
						fileName: path.basename(file),
						mimeType:
							mediaTypes[path.extname(file).toLowerCase()] ??
							"application/octet-stream",
					});
					controller.assertGeneration(input.connectionId, input.generation);
					return attachment;
				}
				case "readAttachment": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							attachmentId: z.string().uuid(),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					const attachment = await readRemoteAttachment(
						manager,
						input,
						input.attachmentId,
					);
					controller.assertGeneration(input.connectionId, input.generation);
					return attachment;
				}
				case "selectRelease": {
					const id = uuid(payload);
					if (id === localConnectionId)
						throw new Error("The local connection uses this app's runtime");
					const result = await dialog.showOpenDialog(window, {
						properties: ["openDirectory"],
					});
					if (result.canceled || !result.filePaths[0]) return false;
					selectedReleases.set(id, result.filePaths[0]);
					return true;
				}
				case "importLocalData": {
					const id = uuid(payload);
					if (id !== localConnectionId)
						throw new Error(
							"Legacy data can only be imported into this device",
						);
					if (intents.list(id).length)
						throw new Error(
							"Reconcile pending operations before importing local data",
						);
					const importerWindow = window;
					const selection = localData.capture();
					return importSelectedLocalData({
						chooseSource: async () => {
							const result = await dialog.showOpenDialog(importerWindow, {
								title: i18n._(msg({ message: "Import local data" })),
								properties: ["openDirectory"],
								defaultPath: path.join(homedir(), ".superset"),
							});
							localData.assertCurrent(selection);
							return result.canceled ? null : (result.filePaths[0] ?? null);
						},
						confirmSource: async (source) => {
							localData.assertCurrent(selection);
							const result = await dialog.showMessageBox(importerWindow, {
								type: "warning",
								message: i18n._(msg({ message: "Import local data" })),
								detail: `${i18n._(msg({ message: "Import data from a stopped legacy backend into an empty local backend. Source data is kept. Start the backend after import." }))}\n\n${source}`,
								buttons: [
									i18n._(msg({ message: "Cancel" })),
									i18n._(msg({ message: "Import" })),
								],
								defaultId: 0,
								cancelId: 0,
							});
							localData.assertCurrent(selection);
							return result.response === 1;
						},
						importData: async (source) => {
							localData.assertCurrent(selection);
							return localData.runSelected(
								async () => true,
								async (namespace) =>
									local.importLocalData(source, { namespaceId: namespace.id }),
							);
						},
					});
				}
				case "rpc":
					return controller.invoke(rpcSchema.parse(payload));
				case "openSocket": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							path: z.string().max(1024),
							socketId: z.string().max(100),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					return sockets.open(
						owner,
						input.socketId,
						input.connectionId,
						input.path,
						(message) => {
							if (!event.sender.isDestroyed())
								event.sender.send(DIRECT_SOCKET_CHANNEL, message);
						},
					);
				}
				case "sendSocket": {
					const { socketId, data } = z
						.object({ socketId: z.string(), data: z.string().max(1024 * 1024) })
						.strict()
						.parse(payload);
					return sockets.send(owner, socketId, data);
				}
				case "closeSocket":
					return sockets.close(owner, z.string().parse(payload));
				default:
					throw new Error("Unsupported workstation action");
			}
		},
	);
	app.on("before-quit", (event) => {
		if (quitting) return;
		event.preventDefault();
		quitting = true;
		reconnect.dispose();
		if (window) sockets.closeOwner(window.webContents.id);
		forwards.dispose();
		void Promise.resolve(controller.dispose()).finally(() => {
			registry.close();
			intents.close();
			ipcMain.removeHandler(DIRECT_CHANNEL);
			app.quit();
		});
	});
	app.on("second-instance", () => {
		window?.show();
		window?.focus();
	});
	app.on("activate", () => {
		if (!window) createWindow();
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	createWindow();
}
