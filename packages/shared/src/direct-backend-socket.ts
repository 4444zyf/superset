import { createHash } from "node:crypto";

export interface DirectSocketIdentity {
	homeDir: string;
	backendId: string;
	namespaceId: string;
	uid: number;
}

export function directBackendSocketPath(
	identity: DirectSocketIdentity,
): string {
	if (
		!Number.isSafeInteger(identity.uid) ||
		identity.uid < 0 ||
		identity.uid > 0xffffffff
	)
		throw new Error("A direct backend requires a valid service UID");
	const hash = createHash("sha256")
		.update(
			JSON.stringify([
				identity.homeDir,
				identity.backendId,
				identity.namespaceId,
			]),
		)
		.digest("hex")
		.slice(0, 32);
	return `/tmp/superset-direct-${identity.uid}-${hash}/control.sock`;
}
