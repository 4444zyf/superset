import { mkdirSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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
import { importSelectedLocalData } from "./lib/ssh-direct/import-local-data";
import { createLocalBackend } from "./lib/ssh-direct/local-backend";
import { OperationIntents } from "./lib/ssh-direct/operation-intents";
import {
	readRemoteAttachment,
	uploadSelectedAttachment,
} from "./lib/ssh-direct/remote-files";
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
	const uuid = (value: unknown) => z.string().uuid().parse(value);
	ipcMain.handle(
		DIRECT_CHANNEL,
		async (event, action: unknown, payload: unknown) => {
			if (
				!window ||
				event.sender !== window.webContents ||
				event.senderFrame !== window.webContents.mainFrame
			)
				throw new Error("Unauthorized workstation caller");
			const owner = event.sender.id;
			switch (action) {
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
					if (input.action === "stop" || input.action === "uninstall") {
						const answer = await dialog.showMessageBox(window, {
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
						if (answer.response !== 1) return { status: "cancelled" };
					}
					reconnect.disarm(input.id);
					if (input.action !== "install") {
						sockets.closeConnection(input.id);
						forwards.closeConnection(input.id);
						await controller.disconnect(input.id);
					}
					if (input.id === localConnectionId)
						return local.control(input.action as "start" | "stop");
					return manager.withRemoteTransport<unknown>(input.id, (transport) =>
						input.action === "install"
							? install(input.id, transport, input.password)
							: controlRemoteBackend({
									transport,
									trustedKeys: trustedKeys(),
									action: input.action,
									...(input.password ? { password: input.password } : {}),
								}),
					);
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
					const info = await stat(file);
					if (!info.isFile() || info.size < 1 || info.size > 25 * 1024 * 1024)
						throw new Error("Choose a nonempty attachment under 25 MiB");
					const bytes = await readFile(file);
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
					return importSelectedLocalData({
						chooseSource: async () => {
							const result = await dialog.showOpenDialog(importerWindow, {
								title: i18n._(msg({ message: "Import local data" })),
								properties: ["openDirectory"],
								defaultPath: path.join(homedir(), ".superset"),
							});
							return result.canceled ? null : (result.filePaths[0] ?? null);
						},
						confirmSource: async (source) => {
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
							return result.response === 1;
						},
						importData: async (source) => {
							reconnect.disarm(id);
							sockets.closeConnection(id);
							forwards.closeConnection(id);
							await controller.disconnect(id);
							return local.importLocalData(source);
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
