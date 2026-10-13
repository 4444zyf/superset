import { contextBridge, ipcRenderer } from "electron";
import {
	DIRECT_CHANNEL,
	DIRECT_CONNECTION_CHANNEL,
	DIRECT_SOCKET_CHANNEL,
	type DirectConnectionEvent,
	type DirectSocketEvent,
	type DirectWorkstationApi,
} from "../shared/direct-workstation";

declare global {
	interface Window {
		directWorkstation: DirectWorkstationApi;
	}
}

const invoke = (action: string, payload?: unknown) =>
	ipcRenderer.invoke(DIRECT_CHANNEL, action, payload);
const directWorkstation: DirectWorkstationApi = {
	about: () => invoke("about"),
	openBrandLink: (id) => invoke("openBrandLink", id),
	platform: process.platform,
	localData: {
		listNamespaces: () => invoke("localData.list"),
		createNamespace: (label) => invoke("localData.create", label),
		selectNamespace: (id) => invoke("localData.select", id),
		removeNamespace: (id) => invoke("localData.remove", id),
		discoverLegacySources: () => invoke("localData.discover"),
		previewLegacySources: (ids) => invoke("localData.preview", ids),
		importSource: (input) => invoke("localData.import", input),
		listLegacyHistory: (input) => invoke("localData.history", input),
		readLegacyHistory: (input) => invoke("localData.readHistory", input),
	},
	list: () => invoke("list"),
	save: (profile) => invoke("save", profile),
	remove: (id) => invoke("remove", id),
	test: (id) => invoke("test", id),
	testProfile: (profile) => invoke("testProfile", profile),
	connect: (id, password) =>
		invoke("connect", { id, ...(password ? { password } : {}) }),
	refreshFeatures: (connection) =>
		invoke("refreshFeatures", {
			connectionId: connection.connectionId,
			generation: connection.generation,
		}),
	disconnect: (id) => invoke("disconnect", id),
	selectRelease: (id) => invoke("selectRelease", id),
	importLocalData: (id) => invoke("importLocalData", id),
	listPending: (id) => invoke("listPending", id),
	reconcile: (id) => invoke("reconcile", id),
	acknowledge: (connection, operationId) =>
		invoke("acknowledge", {
			connectionId: connection.connectionId,
			generation: connection.generation,
			operationId,
		}),
	chooseAttachment: (connection) =>
		invoke("chooseAttachment", {
			connectionId: connection.connectionId,
			generation: connection.generation,
		}),
	readAttachment: (connection, attachmentId) =>
		invoke("readAttachment", {
			connectionId: connection.connectionId,
			generation: connection.generation,
			attachmentId,
		}),
	openPort: (connection, workspaceId, port) =>
		invoke("openPort", {
			connectionId: connection.connectionId,
			generation: connection.generation,
			workspaceId,
			port,
		}),
	closePort: (id) => invoke("closePort", id),
	control: (id, action, password) =>
		invoke("control", { id, action, ...(password ? { password } : {}) }),
	rpc: (request) => invoke("rpc", request),
	openSocket: (connection, path, socketId) =>
		invoke("openSocket", {
			connectionId: connection.connectionId,
			generation: connection.generation,
			path,
			socketId,
		}),
	sendSocket: (socketId, data) => invoke("sendSocket", { socketId, data }),
	closeSocket: (socketId) => invoke("closeSocket", socketId),
	onSocket: (listener) => {
		const wrapped = (_event: unknown, message: DirectSocketEvent) =>
			listener(message);
		ipcRenderer.on(DIRECT_SOCKET_CHANNEL, wrapped);
		return () => ipcRenderer.removeListener(DIRECT_SOCKET_CHANNEL, wrapped);
	},
	onConnection: (listener) => {
		const wrapped = (_event: unknown, message: DirectConnectionEvent) =>
			listener(message);
		ipcRenderer.on(DIRECT_CONNECTION_CHANNEL, wrapped);
		return () => ipcRenderer.removeListener(DIRECT_CONNECTION_CHANNEL, wrapped);
	},
};

contextBridge.exposeInMainWorld("directWorkstation", directWorkstation);
