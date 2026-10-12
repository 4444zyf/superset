import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareVerifiedNodeRuntime, verifyNodeArchive } from "./node-runtime";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("official Node checksum mismatch, absent target and ambiguous records fail before extraction", () => {
	const bytes = Buffer.from("trusted archive");
	const filename = "node-v24.21.0-darwin-arm64.tar.gz";
	const line = `${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`;
	verifyNodeArchive(bytes, line, filename);
	expect(() =>
		verifyNodeArchive(Buffer.from("modified archive"), line, filename),
	).toThrow("checksum");
	expect(() => verifyNodeArchive(bytes, line, "another.tar.gz")).toThrow(
		"checksum",
	);
	expect(() => verifyNodeArchive(bytes, line + line, filename)).toThrow(
		"checksum",
	);
});

test("a verified archive is extracted privately and cannot reuse a modified extracted Node cache", async () => {
	const root = mkdtempSync(join(tmpdir(), "node-release-cache-"));
	roots.push(root);
	const archiveName = "node-v24.21.0-darwin-arm64";
	const source = join(root, "source", archiveName, "bin");
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "node"), "verified Node bytes");
	const cache = join(root, "cache");
	mkdirSync(cache);
	const archive = join(cache, `${archiveName}.tar.gz`);
	execFileSync("tar", [
		"-czf",
		archive,
		"-C",
		join(root, "source"),
		archiveName,
	]);
	mkdirSync(join(cache, archiveName, "bin"), { recursive: true });
	writeFileSync(
		join(cache, archiveName, "bin/node"),
		"attacker modified extracted cache",
	);
	const checksums = `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${archiveName}.tar.gz\n`;
	const output = await prepareVerifiedNodeRuntime({
		archivePath: archive,
		checksums,
		archiveName,
		destinationDir: join(root, "lib"),
	});
	expect(readFileSync(output, "utf8")).toBe("verified Node bytes");
	expect(readFileSync(join(cache, archiveName, "bin/node"), "utf8")).toBe(
		"attacker modified extracted cache",
	);
});
