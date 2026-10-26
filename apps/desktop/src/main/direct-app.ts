import { createBrowserSiteCookies } from "./lib/browser/browser-site-cookies";
import { currentBrowserCookies } from "./lib/browser/current-browser-cookies";
import { currentBrowserDesignMode } from "./lib/browser/current-browser-design-mode";
import { BrowserImportService } from "./lib/browser/browser-import-service";
import {
	listAllChromiumProfiles,
	hasUnreadableChromiumBrowser,
} from "./lib/browser/chromium-profiles";
import { readHistoryFromProfile } from "./lib/browser/chrome-history-import";
import { importCookiesIntoSession } from "./lib/browser/chrome-cookie-import";
import { requestFullDiskAccess } from "../lib/trpc/routers/permissions/native-permissions";
import { opaqueScreenshot } from "./lib/browser/opaque-screenshot";
import {
	WorkstationBrowserScreenshots,
	screenshotThumbnail,
} from "./lib/ssh-direct/workstation-browser-screenshots";
import { captureCurrentPage } from "./lib/browser/capture-current-page";
import { WorkstationBrowserDownloads } from "./lib/ssh-direct/workstation-browser-downloads";
import { WorkstationBrowserReadChannels } from "./lib/ssh-direct/workstation-browser-read-channel";
import { currentWorkstationBrowserBridgePanes } from "./lib/ssh-direct/workstation-browser-bridge-panes";
import { clearBrowserSessionData } from "./lib/browser/clear-browser-session-data";
import { randomUUID } from "node:crypto";
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
import {
	PRODUCT_BRAND,
	resolveBrandLink,
} from "@superset/shared/product-brand";
import { restoreResourceRefSchema } from "@superset/shared/workspace-restore";
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	screen,
	session,
	shell,
	webContents,
} from "electron";
import { z } from "zod";
import {
	DIRECT_CHANNEL,
	DIRECT_CONNECTION_CHANNEL,
	DIRECT_RESTORE_CHANNEL,
	DIRECT_SETUP_CHANNEL,
	DIRECT_SOCKET_CHANNEL,
	DIRECT_VIEW_FLUSH_CHANNEL,
	DIRECT_WINDOW_CLOSE_CHANNEL,
	WORKSTATION_BROWSER_CHANNEL,
	WORKSTATION_DOWNLOADS_CHANNEL,
	WORKSTATION_SCREENSHOTS_CHANNEL,
} from "../shared/direct-workstation";
import {
	workstationBrowserPaneSchema,
	workstationBrowserDataTypeSchema,
	workstationBrowserDeviceEmulationSchema,
} from "../shared/workstation-browser";
import { browserPageStateSchema } from "../shared/workspace-view-v2";
import { browserManager } from "./lib/browser/browser-manager";
import { lockProductProfile } from "./lib/product-identity";
import { isSafeExternalUrl } from "./lib/safe-url/scheme";
import { AutomaticReconnect } from "./lib/ssh-direct/automatic-reconnect";
import { uploadClipboardAttachment } from "./lib/ssh-direct/clipboard-attachment";
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
import { SetupProgress } from "./lib/ssh-direct/setup-progress";
import { SocketBroker } from "./lib/ssh-direct/socket-broker";
import { WindowCloseGate } from "./lib/ssh-direct/window-close-gate";
import { closeWindowTransports } from "./lib/ssh-direct/window-transports";
import { WorkspaceRestoreCoordinator } from "./lib/ssh-direct/workspace-restore-coordinator";
import { WorkspaceViewStore } from "./lib/ssh-direct/workspace-view-store";
import { WorkstationBrowserHistory } from "./lib/ssh-direct/workstation-browser-history";
import { WorkstationBrowserPreferences } from "./lib/ssh-direct/workstation-browser-preferences";
import { browserPreferencePatchSchema } from "../shared/workstation-browser-preferences";
import { WorkstationBrowserIcons } from "./lib/ssh-direct/workstation-browser-icons";
import { WorkstationBrowserNavigation } from "./lib/ssh-direct/workstation-browser-navigation";
import { WorkstationBrowserRegistry } from "./lib/ssh-direct/workstation-browser-registry";
import { guardWorkstationWebviews } from "./lib/ssh-direct/workstation-browser-security";
import { WorkstationChatDrafts } from "./lib/ssh-direct/workstation-chat-drafts";
import { WorkstationController } from "./lib/ssh-direct/workstation-controller";
import { WorkstationPreferences } from "./lib/ssh-direct/workstation-preferences";

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
	if (!lockProductProfile(app, process.env.SUPERSET_WORKSPACE_ID)) {
		app.quit();
		return;
	}
	await app.whenReady();
	await initI18nAsync(resolveLocale(app.getPreferredSystemLanguages()));
	app.setAboutPanelOptions({
		applicationName: PRODUCT_BRAND.displayName,
		applicationVersion: app.getVersion(),
		copyright: PRODUCT_BRAND.upstreamCopyright,
		credits: i18n._(msg({ message: "Unofficial modified version" })),
		website: PRODUCT_BRAND.forkRepository,
	});
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: PRODUCT_BRAND.displayName,
				submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
		]),
	);
	const icon = path.join(
		app.isPackaged ? app.getAppPath() : path.join(__dirname, "../../src"),
		"resources/build/icons",
		app.isPackaged ? "icon.png" : "icon-dev.png",
	);
	app.dock?.setIcon(icon);
	const dataDir = path.join(app.getPath("userData"), "direct-workstation");
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	const registry = new ConnectionRegistry(path.join(dataDir, "connections.db"));
	const intents = new OperationIntents(
		path.join(dataDir, "operation-intents.db"),
	);
	const preferences = new WorkstationPreferences(
		path.join(dataDir, "preferences.db"),
	);
	const chatDrafts = new WorkstationChatDrafts(
		path.join(dataDir, "chat-drafts.db"),
	);
	await initI18nAsync(
		preferences.read().values.language ??
			resolveLocale(app.getPreferredSystemLanguages()),
	);
	const selectedReleases = new Map<string, string>();
	const passwords = new Map<string, string>();
	const automaticConnections = new Set<string>();
	let window: BrowserWindow | null = null;
	const progress = new SetupProgress((snapshot) => {
		if (window && !window.webContents.isDestroyed())
			window.webContents.send(DIRECT_SETUP_CHANNEL, snapshot);
	});
	const resourcesRoot = app.isPackaged
		? path.join(process.resourcesPath, "resources")
		: path.join(__dirname, "../resources");
	let browserPreferences: WorkstationBrowserPreferences | null = null;
	try {
		browserPreferences = new WorkstationBrowserPreferences(
			path.join(dataDir, "browser-preferences.db"),
		);
	} catch (error) {
		console.error("[workstation] Browser preferences are unavailable", error);
	}
	const requireBrowserPreferences = () => {
		if (!browserPreferences) throw Error("Browser preferences are unavailable");
		return browserPreferences;
	};
	let browserHistory: WorkstationBrowserHistory | null = null;
	try {
		browserHistory = new WorkstationBrowserHistory(
			path.join(dataDir, "browser-history.db"),
			readFileSync(
				path.join(resourcesRoot, "migrations/0026_browser_history.sql"),
				"utf8",
			),
		);
	} catch (error) {
		console.error("[workstation] Browser history is unavailable", error);
	}
	let browserDownloads: WorkstationBrowserDownloads | null = null;
	let downloadsRevision = 0;
	try {
		browserDownloads = new WorkstationBrowserDownloads(
			path.join(dataDir, "browser-downloads.db"),
			readFileSync(
				path.join(resourcesRoot, "migrations/0051_add_downloads.sql"),
				"utf8",
			),
			{
				session: () => session.fromPartition("persist:superset"),
				directory: () => app.getPath("downloads"),
				showInFolder: (path) => shell.showItemInFolder(path),
				openFile: (path) => shell.openPath(path),
			},
		);
		const store = browserDownloads;
		store.manager.on("changed", () => {
			downloadsRevision++;
			if (window && !window.webContents.isDestroyed())
				window.webContents.send(WORKSTATION_DOWNLOADS_CHANNEL, {
					revision: downloadsRevision,
					rows: store.listForDisplay(),
				});
		});
	} catch (error) {
		console.error("[workstation] Browser downloads are unavailable", error);
	}
	const requireBrowserDownloads = () => {
		if (!browserDownloads) throw Error("Browser downloads are unavailable");
		return browserDownloads;
	};

	let browserScreenshots: WorkstationBrowserScreenshots | null = null,
		screenshotsRevision = 0;
	try {
		browserScreenshots = new WorkstationBrowserScreenshots(
			path.join(dataDir, "browser-screenshots.db"),
			readFileSync(
				path.join(resourcesRoot, "migrations/0052_add_screenshots.sql"),
				"utf8",
			),
			{
				directory: () => {
					const directory = path.join(
						app.getPath("pictures"),
						`${PRODUCT_BRAND.displayName} Screenshots`,
					);
					mkdirSync(directory, { recursive: true });
					return directory;
				},
				showInFolder: (path) => shell.showItemInFolder(path),
				openFile: (path) => shell.openPath(path),
			},
		);
		const store = browserScreenshots;
		store.manager.on("changed", () => {
			screenshotsRevision++;
			if (window && !window.webContents.isDestroyed())
				window.webContents.send(WORKSTATION_SCREENSHOTS_CHANNEL, {
					revision: screenshotsRevision,
					rows: store.listForDisplay(),
				});
		});
	} catch (error) {
		console.error("[workstation] Browser screenshots are unavailable", error);
	}
	const requireBrowserScreenshots = () => {
		if (!browserScreenshots) throw Error("Browser screenshots are unavailable");
		return browserScreenshots;
	};

	const browserImports = new BrowserImportService({
		profiles: () =>
			listAllChromiumProfiles(app.getPath("home"), app.getPath("appData")),
		needsFullDiskAccess: () =>
			process.platform === "darwin" &&
			hasUnreadableChromiumBrowser(app.getPath("home"), app.getPath("appData")),
		readHistory: readHistoryFromProfile,
		writeHistory: (entries) => {
			if (!browserHistory) throw Error("Browser history is unavailable");
			browserHistory.importEntries(entries);
		},
		importCookies: (profile, key) =>
			importCookiesIntoSession(
				session.fromPartition("persist:superset"),
				profile,
				key,
			),
		requestFullDiskAccess: async () => {
			if (process.platform === "darwin") await requestFullDiskAccess();
		},
	});
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
		connectionProbe?: {
			platform: string;
			architecture: string;
			uid: number;
			user: string;
			homeDir: string;
			groupname?: string;
			macOS?: string;
		},
	) => {
		const probe =
			connectionProbe?.platform === "darwin" &&
			["arm64", "x86_64"].includes(connectionProbe.architecture) &&
			connectionProbe.groupname &&
			connectionProbe.macOS
				? {
						target:
							connectionProbe.architecture === "arm64"
								? ("darwin-arm64" as const)
								: ("darwin-x64" as const),
						uid: connectionProbe.uid,
						username: connectionProbe.user,
						groupname: connectionProbe.groupname,
						userHome: connectionProbe.homeDir,
						macOS: connectionProbe.macOS,
					}
				: await probeRemoteBackend(transport);
		return installRemoteBackend({
			transport,
			releaseRoot:
				selectedReleases.get(id) ??
				path.join(resourcesRoot, "direct-backend", probe.target),
			trustedKeys: trustedKeys(),
			probe,
			onPhase: (phase) =>
				progress.phase(
					id,
					phase as
						| "probing"
						| "checking-release"
						| "preparing-upload"
						| "uploading"
						| "installing",
				),
			...(password ? { password } : {}),
		});
	};
	let browserRegistry: WorkstationBrowserRegistry | null = null;
	let browserReadChannels: WorkstationBrowserReadChannels | null = null;
	let rendererBrowserReadReady = false;
	const cleanBrowser = (operation: () => void) => {
		try {
			operation();
		} catch (error) {
			console.error("[workstation] Browser cleanup failed", error);
		}
	};
	const manager = new DirectConnectionManager({
		registry,
		local,
		onStatus: (id, status) => {
			browserReadChannels?.sync(id);
			if (status.state !== "ready")
				cleanBrowser(() => browserRegistry?.closeConnection(id));
			if (["probing", "forwarding", "verifying"].includes(status.state))
				progress.phase(
					id,
					status.state as "probing" | "forwarding" | "verifying",
				);
		},
		install: async (profile, transport, probe) => {
			if (automaticConnections.has(profile.id))
				throw new Error(
					"The backend is unavailable. Connect explicitly to install or start it.",
				);
			await install(profile.id, transport, passwords.get(profile.id), probe);
		},
	});
	const controller = new WorkstationController(manager, intents);
	const forwards = new DirectPortForwardManager(manager);
	const browserNavigation = new WorkstationBrowserNavigation({
		isLocal: (id) => registry.get(id)?.kind === "local",
		prepare: async (descriptor, workspaceId, port) => {
			controller.assertGeneration(
				descriptor.connectionId,
				descriptor.generation,
			);
			const forward = await forwards.open(
				descriptor.connectionId,
				workspaceId,
				port,
			);
			controller.assertGeneration(
				descriptor.connectionId,
				descriptor.generation,
			);
			return forward;
		},
		send: (owner, event) => {
			if (window?.webContents.id === owner && !window.webContents.isDestroyed())
				window.webContents.send(WORKSTATION_BROWSER_CHANNEL, event);
		},
	});
	browserRegistry = new WorkstationBrowserRegistry({
		bindNavigation: (owner, pane, descriptor, guestId, current) => {
			const guest = webContents.fromId(guestId);
			if (!guest || guest.isDestroyed())
				throw Error("Browser guest is unavailable");
			return browserNavigation.bind(owner, pane, descriptor, guest, current);
		},
		manager: browserManager,
		getGuest: (id) => webContents.fromId(id) ?? undefined,
		describe: (id) => controller.describe(id),
		checkWorkspace: async (pane) => {
			const workspace = await controller.invoke({
				connectionId: pane.connectionId,
				generation: pane.generation,
				path: "workspace.get",
				type: "query",
				input: { id: pane.workspaceId },
			});
			if (
				!workspace ||
				typeof workspace !== "object" ||
				!("id" in workspace) ||
				workspace.id !== pane.workspaceId
			)
				throw new Error("Browser workspace is unavailable");
		},
		send: (owner, event) => {
			if (window?.webContents.id === owner && !window.webContents.isDestroyed())
				window.webContents.send(WORKSTATION_BROWSER_CHANNEL, event);
		},
	});
	const browserIcons = new WorkstationBrowserIcons({
		resolve: async (owner, pane, candidate) => {
			const descriptor = browserRegistry?.getRegistration(owner, pane);
			if (!descriptor) return null;
			const guestId = browserRegistry?.getWebContentsId(owner, pane);
			if (!guestId) return null;
			const guest = webContents.fromId(guestId);
			if (!guest || guest.isDestroyed()) return null;
			const url = await browserNavigation.resolveIcon(owner, pane, candidate);
			if (!url) return null;
			return {
				key: JSON.stringify([
					owner,
					pane.connectionId,
					pane.generation,
					descriptor.backendId,
					descriptor.namespaceId,
					descriptor.instanceId,
					pane.workspaceId,
					pane.paneId,
					pane.registrationId,
					guestId,
					candidate,
				]),
				url,
				current: () => {
					const current = browserRegistry?.getRegistration(owner, pane);
					return (
						!!current &&
						current.backendId === descriptor.backendId &&
						current.namespaceId === descriptor.namespaceId &&
						current.instanceId === descriptor.instanceId &&
						browserRegistry?.getWebContentsId(owner, pane) === guestId &&
						browserNavigation.iconAllowed(owner, pane, candidate)
					);
				},
				resolveRedirect: (redirect) =>
					browserNavigation.resolveIcon(owner, pane, candidate, redirect),
				fetch: (url, options) => guest.session.fetch(url, options),
			};
		},
	});
	const sockets = new SocketBroker((id, socketPath) =>
		socketPath.startsWith("/terminal-restore/")
			? manager.openRestoredSocket(id, socketPath)
			: manager.openSocket(id, socketPath),
	);
	let quitting = false;
	let quitRequested = false;
	const closeGate = new WindowCloseGate();
	let rendererOwnerEpoch = 0;
	browserReadChannels = new WorkstationBrowserReadChannels({
		navigationV1: true,
        evaluationV1:true,
		getTarget: (id) => {
			if (!rendererBrowserReadReady || !window || window.isDestroyed() || window.webContents.isDestroyed()) return null;
			const lease = manager.getLease(id);
			if (!lease || manager.getStatus(id).state !== "ready") return null;
			const capabilities = manager.getVerifiedDescription(id).capabilities as Record<string, unknown> | undefined;
			if (capabilities?.workstationBrowserReadBridgeConnectV1 !== true) return null;
			return { ownerId: window.webContents.id, ownerEpoch: rendererOwnerEpoch, descriptor: controller.describe(id) };
		},
		openSocket: (id, socketPath) => manager.openSocket(id, socketPath),
		panes: (target, isCurrent) => currentWorkstationBrowserBridgePanes({
			ownerId: target.ownerId,
			descriptor: target.descriptor,
			isCurrent,
			registry: browserRegistry!,
			manager: browserManager,
			navigate: (owner, pane, url, current) => browserNavigation.navigate(owner, pane, url, current),
			normalizePng: (base64) => opaqueScreenshot(
				nativeImage.createFromBuffer(Buffer.from(base64, "base64")),
				(bitmap, size) => nativeImage.createFromBitmap(bitmap, size),
			).toPNG().toString("base64"),
			canonical: (owner, pane, raw) => browserNavigation.canonical(owner, pane, raw),
		}),
	});
	const reconnect = new AutomaticReconnect({
		getStatus: (id) => manager.getStatus(id),
		connect: async (id) => {
			sockets.closeConnection(id);
			forwards.closeConnection(id);
			automaticConnections.add(id);
			try {
				await manager.connect(id, {
					mode: "restore-existing",
				});
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
	let viewStore: WorkspaceViewStore | null = null;
	try {
		viewStore = new WorkspaceViewStore(
			path.join(dataDir, "workspace-views.db"),
		);
	} catch (error) {
		console.error(
			"Workspace view storage unavailable",
			error instanceof Error ? error.name : "unknown",
		);
	}
	const windowBounds = () => ({
		...(window?.getNormalBounds() ?? { x: 0, y: 0, width: 1280, height: 850 }),
		maximized: window?.isMaximized() ?? false,
	});
	const views = viewStore
		? new WorkspaceRestoreCoordinator({
				store: viewStore,
				registry,
				manager,
				controller,
				window: windowBounds,
				notify(snapshot) {
					if (window && !window.webContents.isDestroyed())
						window.webContents.send(DIRECT_RESTORE_CHANNEL, snapshot);
				},
				onReady(descriptor) {
					reconnect.arm(
						descriptor,
						registry.get(descriptor.connectionId)?.kind ?? "ssh",
					);
				},
			})
		: null;
	const requireViews = () => {
		if (!views) throw new Error("Workspace view storage is unavailable");
		return views;
	};
	let windowSaveTimer: ReturnType<typeof setTimeout> | undefined;
	let flushWaiter: {
		requestId: string;
		owner: number;
		resolve(): void;
	} | null = null;
	const flushWindow = async (current: BrowserWindow) => {
		clearTimeout(windowSaveTimer);
		const saveBounds = views?.updateWindow(windowBounds()).catch(() => {});
		const requestId = randomUUID();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					await new Promise<void>((resolve) => {
						flushWaiter = { requestId, owner: current.webContents.id, resolve };
						if (!current.webContents.isDestroyed())
							current.webContents.send(DIRECT_VIEW_FLUSH_CHANNEL, {
								requestId,
							});
						else resolve();
					});
					await saveBounds;
					await views?.flushWrites();
				})(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 500);
				}),
			]);
		} finally {
			clearTimeout(timer);
			flushWaiter?.resolve();
			flushWaiter = null;
		}
	};
	const createWindow = () => {
		let saved: ReturnType<WorkspaceViewStore["read"]>["snapshot"] = null;
		try {
			saved = viewStore?.read().snapshot ?? null;
		} catch {}
		const workArea = screen.getDisplayMatching(
			saved?.window ?? screen.getPrimaryDisplay().workArea,
		).workArea;
		const width = Math.min(
			Math.max(saved?.window.width ?? 1280, 800),
			Math.max(800, workArea.width),
		);
		const height = Math.min(
			Math.max(saved?.window.height ?? 850, 600),
			Math.max(600, workArea.height),
		);
		window = new BrowserWindow({
			icon,
			width,
			height,
			x: Math.max(
				workArea.x,
				Math.min(
					saved?.window.x ??
						workArea.x + Math.floor((workArea.width - width) / 2),
					workArea.x + workArea.width - width,
				),
			),
			y: Math.max(
				workArea.y,
				Math.min(
					saved?.window.y ??
						workArea.y + Math.floor((workArea.height - height) / 2),
					workArea.y + workArea.height - height,
				),
			),
			minWidth: 800,
			minHeight: 600,
			title: PRODUCT_BRAND.displayName,
			backgroundColor: "#09090b",
			titleBarStyle: "hiddenInset",
			webPreferences: {
				preload: path.join(__dirname, "../preload/index.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webviewTag: true,
			},
		});
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		guardWorkstationWebviews(window.webContents);
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		const owner = window.webContents.id;
		cleanBrowser(() => browserRegistry?.activateOwner(owner));
		rendererOwnerEpoch++;
		views?.activateOwner(owner);
		window.webContents.on(
			"did-start-navigation",
			(_event, _url, isInPlace, isMainFrame) => {
				if (isMainFrame && !isInPlace) {
					rendererBrowserReadReady = false;
					browserReadChannels?.closeAll();
					cleanBrowser(() => browserRegistry?.activateOwner(owner));
					rendererOwnerEpoch++;
					closeGate.invalidate();
					views?.activateOwner(owner);
					closeWindowTransports(
						owner,
						registry.list().map((p) => p.id),
						{ sockets, forwards },
					);
				}
			},
		);
		window.webContents.on("did-finish-load", () => {
			if (window?.webContents.id !== owner) return;
			rendererBrowserReadReady = true;
			for (const profile of registry.list()) browserReadChannels?.sync(profile.id);
		});
		if (saved?.window.maximized) window.maximize();
		const currentWindow = window;
		const changedBounds = () => {
			clearTimeout(windowSaveTimer);
			windowSaveTimer = setTimeout(() => {
				if (window === currentWindow)
					void views?.updateWindow(windowBounds()).catch(() => {});
			}, 250);
		};
		window.on("move", changedBounds);
		window.on("resize", changedBounds);
		window.on("maximize", changedBounds);
		window.on("unmaximize", changedBounds);
		let closing = false;
		let allowClose = false;
		window.webContents.on("render-process-gone", () => {
			rendererBrowserReadReady = false;
			browserReadChannels?.closeAll();
			cleanBrowser(() => browserRegistry?.activateOwner(null));
			closeGate.invalidate();
		});
		window.on("close", (event) => {
			if (quitting || allowClose) return;
			event.preventDefault();
			if (closing) return;
			closing = true;
			void closeGate
				.request(owner, rendererOwnerEpoch, "window", (request) =>
					currentWindow.webContents.send(DIRECT_WINDOW_CLOSE_CHANNEL, request),
				)
				.then(async (allowed) => {
					if (!allowed || quitRequested || quitting || window !== currentWindow)
						return;
					views?.invalidate();
					try {
						await flushWindow(currentWindow);
					} finally {
						allowClose = true;
						if (!currentWindow.isDestroyed()) currentWindow.close();
					}
				})
				.catch((error) =>
					console.error("[workstation] Window close failed", error),
				)
				.finally(() => {
					closing = false;
				});
		});
		window.on("closed", () => {
			rendererBrowserReadReady = false;
			browserReadChannels?.closeAll();
			cleanBrowser(() => browserRegistry?.activateOwner(null));
			closeGate.invalidate();
			clearTimeout(windowSaveTimer);
			rendererOwnerEpoch++;
			views?.activateOwner(null);
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
		views?.selectLocalNamespace(localConnectionId);
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
			const callerEpoch = rendererOwnerEpoch;
			const owner = event.sender.id;
			switch (action) {
				case "setBrowserDesignMode":
				case "awaitBrowserDesignSelection":
				case "captureBrowserDesignScreenshot": {
					const { pane } = z
						.object({ pane: workstationBrowserPaneSchema })
						.parse(payload);
					const key = browserRegistry?.getManagerPaneId(owner, pane);
					if (!key) throw new Error("Browser pane is no longer current");
					const designMode = currentBrowserDesignMode(
						browserManager,
						key,
						() =>
							window === callerWindow &&
							rendererOwnerEpoch === callerEpoch &&
							!callerWindow.isDestroyed() &&
							browserRegistry?.getManagerPaneId(owner, pane) === key,
					);
					if (action === "setBrowserDesignMode") {
						const { enabled } = z
							.strictObject({
								pane: workstationBrowserPaneSchema,
								enabled: z.boolean(),
							})
							.parse(payload);
						return designMode.set(enabled);
					}
					if (action === "awaitBrowserDesignSelection") {
						const { opId } = z
							.strictObject({
								pane: workstationBrowserPaneSchema,
								opId: z.string().min(1).max(128),
							})
							.parse(payload);
						return designMode.awaitSelection(opId);
					}
					const { rect } = z
						.strictObject({
							pane: workstationBrowserPaneSchema,
							rect: z.strictObject({
								x: z.number(),
								y: z.number(),
								width: z.number().nonnegative(),
								height: z.number().nonnegative(),
							}),
						})
						.parse(payload);
					return designMode.screenshot(rect);
				}
				case "getBrowserCookieDomains":
				case "forgetBrowserCookieDomain": {
					const siteCookies = createBrowserSiteCookies(
						currentBrowserCookies(
							() => session.fromPartition("persist:superset").cookies,
							() =>
								window === callerWindow &&
								rendererOwnerEpoch === callerEpoch &&
								!callerWindow.isDestroyed(),
						),
					);
					if (action === "getBrowserCookieDomains")
						return siteCookies.getDomains();
					const input = z
						.strictObject({ domain: z.string().min(1).max(253) })
						.parse(payload);
					return siteCookies.forget(input);
				}
				case "getBrowserImportSources":
					return browserImports.getSources();
				case "requestBrowserImportPermissions":
					return browserImports.requestFullDiskAccess();
				case "importBrowserHistory": {
					const { sourceId } = z
						.strictObject({ sourceId: z.string().min(1).max(32768) })
						.parse(payload);
					return browserImports.importHistory(
						sourceId,
						() =>
							window === callerWindow &&
							rendererOwnerEpoch === callerEpoch &&
							!callerWindow.isDestroyed(),
					);
				}
				case "importBrowserCookies": {
					const { sourceId } = z
						.strictObject({ sourceId: z.string().min(1).max(32768) })
						.parse(payload);
					return browserImports.importCookies(sourceId);
				}
				case "captureBrowserScreenshot": {
					const { pane } = z
							.strictObject({ pane: workstationBrowserPaneSchema })
							.parse(payload),
						key = browserRegistry?.getManagerPaneId(owner, pane),
						guest = key ? browserManager.getWebContents(key) : null;
					if (!key || !guest || guest.isDestroyed()) return { status: "stale" };
					const url = guest.getURL(),
						store = requireBrowserScreenshots();
					let pageCurrent = true;
					const onNavigation = (
						_event: unknown,
						_url: string,
						_inPlace: boolean,
						mainFrame: boolean,
					) => {
						if (mainFrame) pageCurrent = false;
					};
					guest.on("did-start-navigation", onNavigation);
					try {
						const captured = await captureCurrentPage({
							current: () => {
								try {
									return (
										pageCurrent &&
										window === callerWindow &&
										rendererOwnerEpoch === callerEpoch &&
										!callerWindow.isDestroyed() &&
										browserRegistry?.getManagerPaneId(owner, pane) === key &&
										browserManager.getWebContents(key) === guest &&
										!guest.isDestroyed() &&
										!guest.isCrashed() &&
										guest.getURL() === url
									);
								} catch {
									return false;
								}
							},
							capture: () => browserManager.capturePageImage(key),
							commit: (capturedImage) => {
								const image = opaqueScreenshot(capturedImage, (bitmap, size) =>
									nativeImage.createFromBitmap(bitmap, size),
								);
								const canonical = browserNavigation.canonical(owner, pane, url);
								const saved = store.manager.save(image, canonical);
								clipboard.writeImage(image);
								return {
									id: saved.id,
									base64: screenshotThumbnail(image).slice(
										"data:image/png;base64,".length,
									),
								};
							},
						});
						return captured.status === "saved"
							? { status: "saved", ...captured.result }
							: captured;
					} finally {
						guest.off("did-start-navigation", onNavigation);
					}
				}
				case "getBrowserScreenshots":
					return {
						revision: screenshotsRevision,
						rows: requireBrowserScreenshots().listForDisplay(),
					};
				case "clearBrowserScreenshots":
					requireBrowserScreenshots().manager.clear();
					return { success: true };
				case "openBrowserScreenshot":
				case "revealBrowserScreenshot": {
					const { id } = z
							.strictObject({ id: z.string().uuid() })
							.parse(payload),
						store = requireBrowserScreenshots(),
						row = store.fileForId(id);
					if (!row) return { success: false };
					if (action === "revealBrowserScreenshot") {
						store.manager.showInFolder(row.savePath);
						return { success: true };
					}
					return {
						success: (await store.manager.openFile(row.savePath)) === "",
					};
				}
				case "getBrowserDownloads": {
					return {
						revision: downloadsRevision,
						rows: requireBrowserDownloads().listForDisplay(),
					};
				}
				case "clearBrowserDownloads": {
					requireBrowserDownloads().manager.clear();
					return { success: true };
				}
				case "cancelBrowserDownload": {
					const { id } = z
						.strictObject({ id: z.string().uuid() })
						.parse(payload);
					return { cancelled: requireBrowserDownloads().manager.cancel(id) };
				}
				case "openBrowserDownload":
				case "revealBrowserDownload": {
					const { id } = z
							.strictObject({ id: z.string().uuid() })
							.parse(payload),
						store = requireBrowserDownloads(),
						row = store.fileForId(id);
					if (!row) return { success: false };
					if (action === "revealBrowserDownload") {
						store.manager.showInFolder(row.savePath);
						return { success: true };
					}
					return {
						success: (await store.manager.openFile(row.savePath)) === "",
					};
				}
				case "clearBrowserData": {
					const input = z
						.strictObject({ type: workstationBrowserDataTypeSchema })
						.parse(payload);
					return clearBrowserSessionData(
						session.fromPartition("persist:superset"),
						input,
					);
				}
				case "setBrowserDeviceEmulation": {
					const { pane, params } = z
						.strictObject({
							pane: workstationBrowserPaneSchema,
							params: workstationBrowserDeviceEmulationSchema,
						})
						.parse(payload);
					const key = browserRegistry?.getManagerPaneId(owner, pane);
					if (!key) return { status: "stale" };
					const guest = browserManager.getWebContents(key);
					if (!guest || guest.isDestroyed() || guest.isCrashed())
						return { status: "stale" };
					browserManager.setDeviceEmulation(key, params);
					return { status: "requested" };
				}
				case "openBrowserDevTools": {
					const { pane } = z
						.strictObject({ pane: workstationBrowserPaneSchema })
						.parse(payload);
					const key = browserRegistry?.getManagerPaneId(owner, pane);
					if (!key) return { status: "stale" };
					browserManager.openDevTools(key);
					return { status: "requested" };
				}
				case "reloadBrowser": {
					const { pane, hard } = z
						.strictObject({
							pane: workstationBrowserPaneSchema,
							hard: z.boolean().optional(),
						})
						.parse(payload);
					const key = browserRegistry?.getManagerPaneId(owner, pane);
					const guest = key ? browserManager.getWebContents(key) : null;
					if (!guest || guest.isDestroyed()) return { status: "stale" };
					if (hard) guest.reloadIgnoringCache();
					else guest.reload();
					return { status: "requested" };
				}
				case "getBrowserPreferences":
					return requireBrowserPreferences().read();
				case "updateBrowserPreferences":
					return requireBrowserPreferences().update(
						z
							.strictObject({
								expectedRevision: z.number().int().nonnegative(),
								patch: browserPreferencePatchSchema,
							})
							.parse(payload),
					);
				case "resetBrowserPreferences":
					return requireBrowserPreferences().reset(
						z
							.strictObject({
								expectedRevision: z.number().int().nonnegative(),
							})
							.parse(payload),
					);
				case "getBrowserIcon": {
					const input = z
						.strictObject({
							pane: workstationBrowserPaneSchema,
							url: z.string().min(1).max(16384),
						})
						.parse(payload);
					return browserIcons.get(owner, input.pane, input.url);
				}
				case "navigateBrowser": {
					const input = z
						.strictObject({
							pane: workstationBrowserPaneSchema,
							url: z.string().min(1).max(8192),
						})
						.parse(payload);
					if (!browserRegistry?.getRegistration(owner, input.pane))
						throw Error("Browser registration changed");
					return browserNavigation.navigate(owner, input.pane, input.url);
				}
				case "updateBrowserPage": {
					const input = z
						.strictObject({
							pane: workstationBrowserPaneSchema,
							resourceId: z
								.string()
								.min(1)
								.max(128)
								.regex(/^[\w-]+$/),
							state: browserPageStateSchema,
						})
						.parse(payload);
					if (browserRegistry?.getRegistration(owner, input.pane)) {
						input.state.url = browserNavigation.canonical(
							owner,
							input.pane,
							input.state.url,
						);
						if (input.state.faviconUrl)
							input.state.faviconUrl = browserNavigation.canonical(
								owner,
								input.pane,
								input.state.faviconUrl,
							);
					}
					return requireViews().updateBrowserPage(
						owner,
						input,
						() => browserRegistry?.getRegistration(owner, input.pane) ?? null,
					);
				}
				case "getBrowserHistory":
				case "searchBrowserHistory":
				case "upsertBrowserHistory":
				case "clearBrowserHistory": {
					if (!browserHistory)
						throw new Error("Browser history is unavailable");
					if (action === "getBrowserHistory") return browserHistory.getAll();
					if (action === "clearBrowserHistory") return browserHistory.clear();
					if (action === "searchBrowserHistory") {
						return browserHistory.search(
							z
								.strictObject({
									query: z.string().max(8192),
									limit: z.number().int().min(1).max(200).optional(),
								})
								.parse(payload),
						);
					}
					return browserHistory.upsert(
						z
							.strictObject({
								url: z.string().max(8192),
								title: z.string().max(4096),
								faviconUrl: z.string().max(16384).nullable().optional(),
							})
							.parse(payload),
					);
				}
				case "registerBrowserPane":
					return browserRegistry?.register(owner, payload);
				case "unregisterBrowserPane":
					return browserRegistry?.unregister(owner, payload);
				case "registerWindowCloseGuard": {
					const { registrationId } = z
						.object({ registrationId: z.string().uuid() })
						.strict()
						.parse(payload);
					closeGate.register(owner, callerEpoch, registrationId);
					return;
				}
				case "unregisterWindowCloseGuard": {
					const { registrationId } = z
						.object({ registrationId: z.string().uuid() })
						.strict()
						.parse(payload);
					closeGate.unregister(owner, callerEpoch, registrationId);
					return;
				}
				case "windowCloseResolved": {
					const input = z
						.object({
							registrationId: z.string().uuid(),
							requestId: z.string().uuid(),
							allow: z.boolean(),
						})
						.strict()
						.parse(payload);
					return closeGate.reply(owner, callerEpoch, input);
				}

				case "openExternal": {
					const url = z.string().min(1).max(8192).parse(payload);
					if (!isSafeExternalUrl(url))
						throw new Error("Unsupported external URL");
					await shell.openExternal(url);
					return;
				}
				case "copyText":
					clipboard.writeText(
						z
							.string()
							.max(8 * 1024 * 1024)
							.parse(payload),
					);
					return;
				case "pasteClipboard":
					event.sender.paste();
					return;
				case "getChatDrafts":
					return chatDrafts.read();
				case "saveChatDrafts":
					return chatDrafts.update(
						payload as Parameters<WorkstationChatDrafts["update"]>[0],
					);
				case "getPreferences":
					return preferences.read();
				case "updatePreferences": {
					const result = preferences.update(
						z
							.object({
								expectedRevision: z.number().int().nonnegative(),
								patch: z.record(z.string(), z.unknown()),
							})
							.strict()
							.parse(payload) as Parameters<
							WorkstationPreferences["update"]
						>[0],
					);
					await initI18nAsync(
						result.values.language ??
							resolveLocale(app.getPreferredSystemLanguages()),
					);
					return result;
				}
				case "getWorkspaceView":
					return (
						views?.read() ?? {
							revision: 0,
							snapshot: null,
							invalid: true,
							navigationRevision: 0,
						}
					);
				case "getWorkspaceViewV2":
					return requireViews().readV2();
				case "saveWorkspaceViewV2":
					return requireViews().saveV2(
						owner,
						z
							.strictObject({
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
							})
							.parse(payload),
					);
				case "saveWorkspaceView":
					return requireViews().save(
						owner,
						z
							.strictObject({
								expectedRevision: z.number().int().nonnegative(),
								navigationRevision: z.number().int().nonnegative(),
								view: z.unknown(),
							})
							.parse(payload),
					);
				case "beginWorkspaceRestore":
					return requireViews().begin(
						owner,
						z
							.strictObject({
								reason: z.enum(["launch", "manual"]),
								navigationRevision: z.number().int().nonnegative(),
							})
							.parse(payload),
					);
				case "getWorkspaceRestore":
					return views?.get() ?? null;
				case "cancelWorkspaceRestore":
					return requireViews().cancel(
						owner,
						z.strictObject({ restoreJobId: z.string().uuid() }).parse(payload)
							.restoreJobId,
					);
				case "forgetWorkspaceView":
					return requireViews().forget(
						owner,
						z
							.strictObject({
								expectedRevision: z.number().int().nonnegative(),
							})
							.parse(payload).expectedRevision,
					);
				case "workspaceViewFlushed": {
					const input = z
						.strictObject({ requestId: z.string().uuid() })
						.parse(payload);
					if (
						flushWaiter?.owner === owner &&
						flushWaiter.requestId === input.requestId
					)
						flushWaiter.resolve();
					return;
				}
				case "inspectPending":
					return controller.inspectPending(uuid(payload));
				case "openRestoredTerminal": {
					const input = z
						.strictObject({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							ref: restoreResourceRefSchema,
							socketId: z.string().uuid(),
						})
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					if (input.ref.kind !== "terminal" || !input.ref.executionId)
						throw new Error("A confirmed terminal execution is required");
					if (
						!(await controller.features(input.connectionId, true)).capabilities
							?.workspaceViewRestoreV1
					)
						throw new Error("Strict workspace restore is unsupported");
					controller.assertGeneration(input.connectionId, input.generation);
					if (
						window !== callerWindow ||
						callerEpoch !== rendererOwnerEpoch ||
						event.sender.isDestroyed()
					)
						throw new Error("Workspace window closed");
					return sockets.open(
						owner,
						input.socketId,
						input.connectionId,
						`/terminal-restore/${input.ref.resourceId}?workspaceId=${input.ref.workspaceId}&executionId=${input.ref.executionId}`,
						(message) => {
							if (!event.sender.isDestroyed())
								event.sender.send(DIRECT_SOCKET_CHANNEL, message);
						},
					);
				}
				case "about": {
					const metadata = JSON.parse(
						readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"),
					);
					const legal = app.isPackaged
						? path.join(app.getAppPath(), "resources/legal")
						: path.join(__dirname, "../../src/resources/legal");
					return {
						version: app.getVersion(),
						source: metadata.forkSource,
						license: readFileSync(path.join(legal, "LICENSE.md"), "utf8"),
						notice: readFileSync(path.join(legal, "FORK_NOTICE.md"), "utf8"),
					};
				}
				case "openBrandLink":
					await shell.openExternal(resolveBrandLink(payload));
					return;
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
						async () => {
							const result = local.removeNamespace(id);
							views?.removeLocalNamespace(
								localConnectionId,
								target.namespaceId,
							);
							return result;
						},
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
					views?.invalidate();
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
					if (chatDrafts.hasDrafts({ connectionId: id }))
						throw new Error(i18n._(msg({ message: "Unsaved changes" })));

					reconnect.disarm(id);
					sockets.closeConnection(id);
					forwards.closeConnection(id);
					await controller.disconnect(id);
					registry.remove(id);
					await views?.remove(id);
					selectedReleases.delete(id);
					return;
				}
				case "test":
					return manager.test(uuid(payload));
				case "testProfile": {
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
					const probe = await manager.testProfile(profile);
					return {
						platform: probe.platform,
						architecture: probe.architecture,
						installed: probe.installed,
					};
				}
				case "refreshFeatures": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
						})
						.strict()
						.parse(payload);
					controller.assertGeneration(input.connectionId, input.generation);
					const features = await controller.features(input.connectionId, true);
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
					await views?.recordDisconnect(id);
					reconnect.disarm(id);
					sockets.closeConnection(id);
					forwards.closeConnection(id);
					return controller.disconnect(id);
				}
				case "getSetupSnapshot":
					return progress.get(uuid(payload));
				case "connect": {
					views?.invalidate();
					const { id, password } = z
						.object({
							id: z.string().uuid(),
							password: z.string().max(1024).optional(),
						})
						.strict()
						.parse(payload);
					return progress.run(id, async () => {
						if (id === localConnectionId) localData.assertAvailable();
						reconnect.disarm(id);
						if (password) passwords.set(id, password);
						try {
							await manager.connect(id);
							const descriptor = controller.describe(id);
							const features = await controller.features(id);
							controller.assertGeneration(id, descriptor.generation);
							const connection = { ...descriptor, ...features };
							reconnect.arm(connection, registry.get(id)?.kind ?? "ssh");
							await views?.recordConnect(id).catch(() => {
								console.error("Workspace view was not saved after connection");
							});
							return connection;
						} finally {
							passwords.delete(id);
						}
					});
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
						return localData.runSelected(
							confirmControl,
							async () => local.control(input.action as "start" | "stop"),
							{ allowPending: true },
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
				case "killWorkspacePort": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							workspaceId: z.string().uuid(),
							terminalId: z.string().min(1).max(512),
							port: z.number().int().min(1).max(65535),
						})
						.strict()
						.parse(payload);
					return controller.killWorkspacePort(
						input.connectionId,
						input.generation,
						input.workspaceId,
						input.terminalId,
						input.port,
					);
				}
				case "listPorts": {
					const input = z
						.object({
							connectionId: z.string().uuid(),
							generation: z.number().int().positive(),
							workspaceId: z.string().uuid(),
						})
						.strict()
						.parse(payload);
					return controller.listPorts(
						input.connectionId,
						input.generation,
						input.workspaceId,
					);
				}
				case "preparePort":
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
						if (action === "openPort") await shell.openExternal(forward.url);
						controller.assertGeneration(input.connectionId, input.generation);
						return { id: forward.id, url: forward.url };
					} catch (error) {
						forwards.close(forward.id);
						throw error;
					}
				}
				case "closePort":
					return forwards.close(uuid(payload));
				case "uploadAttachment":
					return uploadClipboardAttachment(controller, manager, payload);
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
				case "rpc": {
					const request = rpcSchema.parse(payload);
					if (
						request.type === "mutation" &&
						request.path === "workspaceCleanup.destroyTrackedV1"
					) {
						controller.assertGeneration(
							request.connectionId,
							request.generation,
						);
						const connection = controller.describe(request.connectionId);
						const { workspaceId } = z
							.object({ workspaceId: z.string().uuid() })
							.passthrough()
							.parse(request.input);
						if (chatDrafts.hasDrafts({ ...connection, workspaceId }))
							throw new Error(i18n._(msg({ message: "Unsaved changes" })));
					}
					return controller.invoke(request);
				}
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
		if (quitRequested) return;
		quitRequested = true;
		const current = window;
		const allowed = current
			? closeGate.request(
					current.webContents.id,
					rendererOwnerEpoch,
					"quit",
					(request) =>
						current.webContents.send(DIRECT_WINDOW_CLOSE_CHANNEL, request),
				)
			: Promise.resolve(true);
		void allowed
			.then((allow) => {
				quitRequested = false;
				if (!allow || window !== current) return;
				quitting = true;
				reconnect.dispose();
				views?.invalidate();
				void (async () => {
					if (current) {
						await flushWindow(current);
						sockets.closeOwner(current.webContents.id);
					}
					rendererOwnerEpoch++;
					closeGate.invalidate();
					views?.activateOwner(null);
					rendererBrowserReadReady = false;
					browserReadChannels?.closeAll();
					cleanBrowser(() => browserDownloads?.manager.stop());
					cleanBrowser(() => browserRegistry?.dispose());
					forwards.dispose();
					await controller.dispose();
				})().finally(() => {
					registry.close();
					intents.close();
					preferences.close();
					chatDrafts.close();
					browserHistory?.close();
					cleanBrowser(() => browserDownloads?.close());
					cleanBrowser(() => browserScreenshots?.close());
					browserPreferences?.close();
					viewStore?.close();
					ipcMain.removeHandler(DIRECT_CHANNEL);
					app.quit();
				});
			})
			.catch((error) => {
				quitRequested = false;
				console.error("[workstation] Quit request failed", error);
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
