import { execFile } from "node:child_process";
import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

export function isMachOBinary(header: Buffer): boolean {
	if (header.length < 4) return false;
	return new Set([
		0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
		0xcafebabf, 0xbfbafeca,
	]).has(header.readUInt32BE());
}

export function directCodesignArguments(
	identity: string,
	entitlements: string,
	developmentPreview = false,
): string[] {
	if (
		!/^[a-fA-F0-9]{40}$/.test(identity) &&
		!(developmentPreview && identity === "-")
	)
		throw new Error(
			"A Developer ID certificate identity is required; ad-hoc signing is only allowed for an explicit development preview",
		);
	return [
		"--force",
		identity === "-" ? "--timestamp=none" : "--timestamp",
		"--options",
		"runtime",
		"--entitlements",
		entitlements,
		"--sign",
		identity,
	];
}

export async function codesignDirectRuntime(
	root: string,
	identity: string,
	entitlements: string,
	developmentPreview = false,
): Promise<void> {
	if (process.platform !== "darwin")
		throw new Error(
			"A native macOS release worker and Developer ID certificate identity are required",
		);
	const arguments_ = directCodesignArguments(
		identity,
		entitlements,
		developmentPreview,
	);
	async function walk(directory: string): Promise<void> {
		for (const file of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, file.name);
			if (file.isDirectory()) {
				await walk(path);
				continue;
			}
			if (!file.isFile())
				throw new Error(
					"Direct signing input contains a symlink or special file",
				);
			const descriptor = openSync(path, "r");
			const header = Buffer.alloc(4);
			let length = 0;
			try {
				length = readSync(descriptor, header, 0, 4, 0);
			} finally {
				closeSync(descriptor);
			}
			if (length < 4 || !isMachOBinary(header)) continue;
			await promisify(execFile)("/usr/bin/codesign", [...arguments_, path]);
			await promisify(execFile)("/usr/bin/codesign", [
				"--verify",
				"--strict",
				path,
			]);
		}
	}
	await walk(root);
}
