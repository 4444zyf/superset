import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { MAX_INLINE_ATTACHMENT_BYTES } from "../trpc/router/attachments/constants";
import {
	readDirectAttachmentForAgent,
	registerDirectAttachmentRoute,
} from "./attachments";

test("agent attachment resolution reads the same private bytes and trusted media type as downloads", async () => {
	const f = fixture();
	try {
		const read = await readDirectAttachmentForAgent(
			f.id,
			f.home,
			new AbortController().signal,
		);
		expect(read).toEqual({
			path: f.payloadPath,
			mimeType: "text/plain",
			data: Buffer.from("original").toString("base64"),
		});
		expect(
			await readDirectAttachmentForAgent(
				"../outside",
				f.home,
				new AbortController().signal,
			),
		).toBeNull();
	} finally {
		f.close();
	}
});

test("agent attachment reads cannot follow a payload symlink", async () => {
	const f = fixture();
	try {
		const outside = join(f.home, "private.txt");
		writeFileSync(outside, "original", { mode: 0o600 });
		rmSync(f.payloadPath);
		symlinkSync(outside, f.payloadPath);
		expect(
			await readDirectAttachmentForAgent(
				f.id,
				f.home,
				new AbortController().signal,
			),
		).toBeNull();
	} finally {
		f.close();
	}
});

test("agent attachment reads reject oversized files before buffering and honor cancellation", async () => {
	const f = fixture();
	try {
		truncateSync(f.payloadPath, MAX_INLINE_ATTACHMENT_BYTES + 1);
		writeFileSync(
			f.metadataPath,
			JSON.stringify({
				...f.metadata,
				sizeBytes: MAX_INLINE_ATTACHMENT_BYTES + 1,
			}),
			{ mode: 0o600 },
		);
		expect(
			await readDirectAttachmentForAgent(
				f.id,
				f.home,
				new AbortController().signal,
			),
		).toBeNull();
		const controller = new AbortController();
		controller.abort();
		await expect(
			readDirectAttachmentForAgent(f.id, f.home, controller.signal),
		).rejects.toThrow();
	} finally {
		f.close();
	}
});

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "direct-attachment-"));
	const id = randomUUID();
	const directory = join(home, "attachments", id);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const metadata = {
		attachmentId: id,
		mediaType: "text/plain",
		originalFilename: "测试笔记.txt",
		sizeBytes: 8,
		createdAt: Date.now(),
	};
	const metadataPath = join(directory, "metadata.json");
	writeFileSync(metadataPath, JSON.stringify(metadata), { mode: 0o600 });
	const payloadPath = join(directory, `${id}.txt`);
	writeFileSync(payloadPath, "original", { mode: 0o600 });
	const app = new Hono();
	registerDirectAttachmentRoute(app, home);
	return {
		home,
		id,
		directory,
		metadata,
		metadataPath,
		payloadPath,
		app,
		close: () => rmSync(home, { recursive: true, force: true }),
	};
}

test("direct attachment download streams the stored bytes with their media type", async () => {
	const f = fixture();
	try {
		const response = await f.app.request(`/attachments/${f.id}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(response.headers.get("content-length")).toBe("8");
		expect(response.headers.get("x-attachment-filename")).toBe(
			encodeURIComponent(f.metadata.originalFilename),
		);
		expect(await response.text()).toBe("original");
	} finally {
		f.close();
	}
});

test("empty attachments retain download privacy and filename headers", async () => {
	const f = fixture();
	try {
		writeFileSync(
			f.metadataPath,
			JSON.stringify({ ...f.metadata, sizeBytes: 0 }),
			{ mode: 0o600 },
		);
		writeFileSync(f.payloadPath, "", { mode: 0o600 });
		const response = await f.app.request(`/attachments/${f.id}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("x-attachment-filename")).toBe(
			encodeURIComponent(f.metadata.originalFilename),
		);
		expect(await response.text()).toBe("");
	} finally {
		f.close();
	}
});

test("oversized valid metadata cannot grow the direct backend's synchronous read", async () => {
	const f = fixture();
	try {
		writeFileSync(
			f.metadataPath,
			JSON.stringify({ ...f.metadata, padding: "x".repeat(16_384) }),
			{ mode: 0o600 },
		);
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(404);
	} finally {
		f.close();
	}
});

test("attachment metadata must describe the requested identity and complete payload", async () => {
	const f = fixture();
	try {
		writeFileSync(
			f.metadataPath,
			JSON.stringify({ ...f.metadata, attachmentId: randomUUID() }),
			{ mode: 0o600 },
		);
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(404);
		writeFileSync(
			f.metadataPath,
			JSON.stringify({ ...f.metadata, sizeBytes: 9 }),
			{ mode: 0o600 },
		);
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(404);
	} finally {
		f.close();
	}
});

test("direct metadata cannot follow symbolic links", async () => {
	const f = fixture();
	try {
		const external = join(f.home, "outside-metadata.json");
		writeFileSync(external, JSON.stringify(f.metadata), { mode: 0o600 });
		rmSync(f.metadataPath);
		symlinkSync(external, f.metadataPath);
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(404);
	} finally {
		f.close();
	}
});

test("attachment directories cannot redirect reads to another directory", async () => {
	const f = fixture();
	try {
		const elsewhere = join(f.home, "attachments", "other");
		renameSync(f.directory, elsewhere);
		symlinkSync(elsewhere, f.directory);
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(404);
	} finally {
		f.close();
	}
});

test("attachment payloads cannot alias other files through hard links", async () => {
	const f = fixture();
	try {
		linkSync(f.payloadPath, join(f.home, "other-file.txt"));
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(404);
	} finally {
		f.close();
	}
});

test("downloads permit the byte limit and reject larger payloads with 413", async () => {
	const f = fixture();
	try {
		truncateSync(f.payloadPath, MAX_INLINE_ATTACHMENT_BYTES);
		writeFileSync(
			f.metadataPath,
			JSON.stringify({ ...f.metadata, sizeBytes: MAX_INLINE_ATTACHMENT_BYTES }),
			{ mode: 0o600 },
		);
		const response = await f.app.request(`/attachments/${f.id}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe(
			String(MAX_INLINE_ATTACHMENT_BYTES),
		);
		await response.body?.cancel();
		truncateSync(f.payloadPath, MAX_INLINE_ATTACHMENT_BYTES + 1);
		writeFileSync(
			f.metadataPath,
			JSON.stringify({
				...f.metadata,
				sizeBytes: MAX_INLINE_ATTACHMENT_BYTES + 1,
			}),
			{ mode: 0o600 },
		);
		expect((await f.app.request(`/attachments/${f.id}`)).status).toBe(413);
	} finally {
		f.close();
	}
});
