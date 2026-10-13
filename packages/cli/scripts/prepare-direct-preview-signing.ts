import { generateKeyPairSync } from "node:crypto";
import { appendFileSync } from "node:fs";
import { prepareDirectSigning } from "./prepare-direct-signing";

export function prepareDirectPreviewSigning(input: {
	keyId: string;
	privateKeyPath: string;
	publicKeysPath: string;
}): Record<string, string> {
	if (!/^preview-darwin-(arm64|x64)$/.test(input.keyId))
		throw new Error("A preview key ID must identify a supported Mac target");
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const keys = {
		[input.keyId]: publicKey.export({ format: "pem", type: "spki" }).toString(),
	};
	prepareDirectSigning({
		...input,
		privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
		publicKeys: JSON.stringify(keys),
	});
	return keys;
}

if (import.meta.main) {
	const argument = (name: string) => {
		const value = process.argv
			.find((value) => value.startsWith(`--${name}=`))
			?.slice(name.length + 3);
		if (!value) throw new Error(`Missing --${name}=...`);
		return value;
	};
	const keys = prepareDirectPreviewSigning({
		keyId: argument("key-id"),
		privateKeyPath: argument("signing-key-file"),
		publicKeysPath: argument("trusted-keys-file"),
	});
	appendFileSync(
		argument("output-file"),
		`public_keys_json=${JSON.stringify(keys)}\n`,
	);
}
