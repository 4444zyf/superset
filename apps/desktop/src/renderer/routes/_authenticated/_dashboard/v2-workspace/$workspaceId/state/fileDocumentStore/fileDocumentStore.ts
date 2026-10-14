import { createFileDocumentStore } from "./createFileDocumentStore";

export {
	createFileDocumentStore,
	type DocumentFilesystemClient,
	decodeBase64,
} from "./createFileDocumentStore";

export const {
	acquireDocument,
	releaseDocument,
	getDocument,
	getDocuments,
	subscribeDocuments,
	dispatchFsEvent,
} = createFileDocumentStore();
