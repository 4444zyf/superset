import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { OpenSshRuntime } from "./ssh.ts";
import { createSshFixture } from "./ssh-fixture.ts";

test("real SSH uploads a batch to paths with spaces and preserves binary bytes", async () => {
	const fixture = await createSshFixture();
	const runtime = new OpenSshRuntime({ configFile: fixture.configFile });
	try {
		const source = join(fixture.root, "local [files]");
		const destination = join(fixture.root, "remote files");
		await mkdir(source);
		await mkdir(destination);
		const decoy = join(fixture.root, "local f");
		await mkdir(decoy);
		const payloads = [
			{ name: "manifest.json", bytes: Buffer.from('{"version":"1.37.3"}') },
			{ name: "node", bytes: Buffer.from([0, 255, 0, 13, 10]) },
		];
		for (const file of payloads)
			await writeFile(join(source, file.name), file.bytes);
		for (const file of payloads)
			await writeFile(join(decoy, file.name), "wrong glob match");
		assert.equal(
			(await runtime.exec(fixture.profile, "printf connected")).stdout,
			"connected",
		);
		await runtime.uploadFiles(
			fixture.profile,
			payloads.map((file) => ({
				localPath: join(source, file.name),
				remotePath: join(destination, file.name),
			})),
		);
		for (const file of payloads)
			assert.deepEqual(
				await readFile(join(destination, file.name)),
				file.bytes,
			);
		assert.equal(
			fixture.stats().authenticatedConnections,
			1,
			"Commands and SFTP must share one authenticated network connection",
		);
	} finally {
		runtime.dispose();
		await fixture.close();
	}
});
