import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	closeSync,
	constants,
	cpSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export function verifyNodeArchive(
	bytes: Buffer,
	checksums: string,
	archiveName: string,
): void {
	if (bytes.length > 256 * 1024 * 1024 || checksums.length > 1024 * 1024)
		throw new Error("Node checksum input exceeds the release limit");
	const matches = checksums
		.split(/\r?\n/)
		.map((line) => line.match(/^([a-fA-F0-9]{64}) [ *](\S+)$/))
		.filter((match) => match?.[2] === archiveName);
	if (
		matches.length !== 1 ||
		matches[0]?.[1]?.toLowerCase() !==
			createHash("sha256").update(bytes).digest("hex")
	)
		throw new Error("Official Node archive checksum verification failed");
}

export async function prepareVerifiedNodeRuntime(input: {
	archivePath: string;
	checksums: string;
	archiveName: string;
	destinationDir: string;
}): Promise<string> {
	if (
		!/^node-v\d+\.\d+\.\d+-(darwin|linux)-(arm64|x64)$/.test(input.archiveName)
	)
		throw new Error("Invalid Node release archive name");
	const descriptor = openSync(
		input.archivePath,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	let bytes: Buffer;
	try {
		const stat = fstatSync(descriptor);
		if (!stat.isFile() || stat.size > 256 * 1024 * 1024)
			throw new Error("The Node archive must be a bounded regular file");
		bytes = readFileSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	verifyNodeArchive(bytes, input.checksums, `${input.archiveName}.tar.gz`);
	const work = mkdtempSync(join(dirname(input.archivePath), "node-verified-"));
	try {
		const archive = join(work, "archive.tar.gz");
		writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
		await promisify(execFile)("tar", ["-xzf", archive, "-C", work]);
		const binary = join(work, input.archiveName, "bin/node");
		if (
			!lstatSync(binary).isFile() ||
			!realpathSync(binary).startsWith(`${work}/`)
		)
			throw new Error(
				"The verified Node archive has no regular runtime binary",
			);
		mkdirSync(input.destinationDir, { recursive: true });
		const output = join(input.destinationDir, "node");
		cpSync(binary, output);
		chmodSync(output, 0o755);
		return output;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}
