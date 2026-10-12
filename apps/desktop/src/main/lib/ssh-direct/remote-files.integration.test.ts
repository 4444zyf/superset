import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRemoteAttachment, uploadSelectedAttachment } from "./remote-files";

test("attachment upload and download round trip through the production host HTTP procedures and disk store", async () => {
	const root = await mkdtemp(join(tmpdir(), "direct-attachment-http-"));
	const child = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(
				new URL("./fixtures/attachment-backend.ts", import.meta.url),
			),
		],
		{
			env: {
				...process.env,
				HOST_MANIFEST_DIR: root,
				NODE_ENV: "test",
				SKIP_ENV_VALIDATION: "1",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stderr = new Response(child.stderr).text();
	const reader = child.stdout.getReader();
	try {
		let output = "";
		const decoder = new TextDecoder();
		while (!output.includes("\n")) {
			const ready = await reader.read();
			if (ready.done)
				throw new Error(
					`Attachment backend exited before readiness: ${await stderr}`,
				);
			output += decoder.decode(ready.value, { stream: true });
			if (output.length > 4096)
				throw new Error("Invalid attachment backend readiness");
		}
		const { url } = JSON.parse(output.split("\n")[0] ?? "") as {
			url: string;
		};
		reader.releaseLock();
		const paths: string[] = [];
		const manager = {
			request: async (
				_id: string,
				input: {
					path: string;
					method?: string;
					body?: string;
					headers?: Record<string, string>;
				},
			) => {
				paths.push(input.path);
				return fetch(new URL(input.path, url), {
					method: input.method,
					body: input.body,
					headers: {
						...input.headers,
						Authorization: "Bearer attachment-test-credential",
					},
				});
			},
		};
		const bytes = new TextEncoder().encode("Attachment round trip — 文件\n");
		const uploaded = await uploadSelectedAttachment(
			manager,
			{ connectionId: "mini" },
			{
				bytes,
				fileName: "/A/private/selected.txt",
				mimeType: "text/plain",
			},
		);
		expect(uploaded.originalFilename).toBe("selected.txt");
		expect(uploaded.sizeBytes).toBe(bytes.byteLength);
		const downloaded = await readRemoteAttachment(
			manager,
			{ connectionId: "mini" },
			uploaded.attachmentId,
		);
		expect(downloaded.bytes).toEqual(bytes);
		expect(downloaded.fileName).toBe("selected.txt");
		expect(downloaded.mimeType).toBe("text/plain");
		expect(paths).toEqual([
			"/trpc/attachments.upload",
			`/attachments/${uploaded.attachmentId}`,
		]);
		expect(
			(await fetch(new URL(`/attachments/${uploaded.attachmentId}`, url)))
				.status,
		).toBe(401);
	} finally {
		try {
			reader.releaseLock();
		} catch {}
		child.kill("SIGTERM");
		await child.exited;
		await stderr;
		await rm(root, { recursive: true, force: true });
	}
});
