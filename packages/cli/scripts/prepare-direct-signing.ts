import { rmSync, writeFileSync } from "node:fs";
import {
	parseDirectReleaseKeys,
	validateDirectSigningIdentity,
} from "./direct-release-resources";

export function prepareDirectSigning(input: {
	privateKey: string | undefined;
	keyId: string | undefined;
	publicKeys: string | undefined;
	privateKeyPath: string;
	publicKeysPath: string;
}): void {
	if (!input.privateKey || !input.keyId || !input.publicKeys)
		throw new Error(
			"Set DIRECT_RELEASE_SIGNING_KEY, DIRECT_RELEASE_KEY_ID and DIRECT_RELEASE_PUBLIC_KEYS_JSON in the production release environment",
		);
	const publicKeys = parseDirectReleaseKeys(JSON.parse(input.publicKeys));
	validateDirectSigningIdentity(input.privateKey, input.keyId, publicKeys);
	writeFileSync(input.privateKeyPath, input.privateKey, {
		flag: "wx",
		mode: 0o600,
	});
	try {
		writeFileSync(input.publicKeysPath, JSON.stringify(publicKeys), {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		rmSync(input.privateKeyPath);
		throw error;
	}
}

if (import.meta.main) {
	const argument = (name: string) => {
		const value = process.argv
			.find((value) => value.startsWith(`--${name}=`))
			?.slice(name.length + 3);
		if (!value) throw new Error(`Missing --${name}=...`);
		return value;
	};
	prepareDirectSigning({
		privateKey: process.env.DIRECT_RELEASE_SIGNING_KEY,
		keyId: process.env.DIRECT_RELEASE_KEY_ID,
		publicKeys: process.env.DIRECT_RELEASE_PUBLIC_KEYS_JSON,
		privateKeyPath: argument("signing-key-file"),
		publicKeysPath: argument("trusted-keys-file"),
	});
}
