import { basename } from "node:path";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import superjson from "superjson";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const uuidPattern =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

interface AttachmentManager {
	request(
		id: string,
		request: {
			path: string;
			method?: string;
			body?: string;
			headers?: Record<string, string>;
		},
	): Promise<Response>;
}

export interface DirectAttachment {
	attachmentId: string;
	originalFilename?: string;
	mediaType: string;
	sizeBytes: number;
}

export interface SelectedAttachment {
	bytes: Uint8Array;
	fileName: string;
	mimeType: string;
}

export async function uploadSelectedAttachment(
	manager: AttachmentManager,
	connection: { connectionId: string },
	selected: SelectedAttachment,
): Promise<DirectAttachment> {
	if (!selected.bytes.byteLength)
		throw new Error(i18n._(msg({ message: "Attachment is empty" })));
	if (selected.bytes.byteLength > MAX_ATTACHMENT_BYTES)
		throw new Error(i18n._(msg({ message: "Attachment exceeds 25 MiB" })));
	const response = await manager.request(connection.connectionId, {
		path: "/trpc/attachments.upload",
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: superjson.stringify({
			data: {
				kind: "base64",
				data: Buffer.from(selected.bytes).toString("base64"),
			},
			mediaType: selected.mimeType || "application/octet-stream",
			originalFilename: basename(selected.fileName.replaceAll("\\", "/")),
		}),
	});
	const envelope = (await response.json()) as {
		error?: { json?: { message?: string }; message?: string };
		result?: { data: Parameters<typeof superjson.deserialize>[0] };
	};
	if (!response.ok || envelope.error)
		throw new Error(
			envelope.error?.json?.message ??
				envelope.error?.message ??
				i18n._(msg({ message: "Attachment upload failed" })),
		);
	const result = envelope.result
		? superjson.deserialize<DirectAttachment>(envelope.result.data)
		: null;
	if (
		!result ||
		!uuidPattern.test(result.attachmentId) ||
		!Number.isSafeInteger(result.sizeBytes) ||
		result.sizeBytes < 1 ||
		result.sizeBytes > MAX_ATTACHMENT_BYTES ||
		typeof result.mediaType !== "string"
	)
		throw new Error(
			i18n._(msg({ message: "Invalid attachment upload response" })),
		);
	return result;
}

function remoteFileName(response: Response, attachmentId: string): string {
	const encoded =
		response.headers.get("X-Attachment-Filename") ??
		response.headers
			.get("Content-Disposition")
			?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
	let name = attachmentId;
	if (encoded) {
		try {
			name = decodeURIComponent(encoded);
		} catch {
			name = attachmentId;
		}
	} else {
		name =
			response.headers
				.get("Content-Disposition")
				?.match(/filename="([^"]+)"/)?.[1] ?? attachmentId;
	}
	return (
		[...basename(name.replaceAll("\\", "/"))]
			.filter((character) => {
				const code = character.charCodeAt(0);
				return code > 31 && code !== 127;
			})
			.join("") || attachmentId
	);
}

export async function readRemoteAttachment(
	manager: AttachmentManager,
	connection: { connectionId: string },
	attachmentId: string,
): Promise<SelectedAttachment> {
	if (!uuidPattern.test(attachmentId))
		throw new Error(i18n._(msg({ message: "Invalid attachment ID" })));
	const response = await manager.request(connection.connectionId, {
		path: `/attachments/${attachmentId}`,
		method: "GET",
	});
	if (!response.ok) {
		const status = response.status;
		throw new Error(
			i18n._(msg({ message: `Attachment read failed (${status})` })),
		);
	}
	const declaredLength = response.headers.get("Content-Length");
	if (declaredLength && Number(declaredLength) > MAX_ATTACHMENT_BYTES) {
		await response.body?.cancel();
		throw new Error(i18n._(msg({ message: "Attachment exceeds 25 MiB" })));
	}
	const chunks: Uint8Array[] = [];
	let length = 0;
	const reader = response.body?.getReader();
	if (!reader)
		throw new Error(i18n._(msg({ message: "Attachment response is empty" })));
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > MAX_ATTACHMENT_BYTES) {
				await reader.cancel();
				throw new Error(i18n._(msg({ message: "Attachment exceeds 25 MiB" })));
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return {
		bytes,
		mimeType:
			response.headers.get("Content-Type") ?? "application/octet-stream",
		fileName: remoteFileName(response, attachmentId),
	};
}
