import type { ConnectionProfile } from "@superset/direct-connection";

function destination(profile: ConnectionProfile | null): string {
	return JSON.stringify(
		profile && [
			profile.kind ?? "ssh",
			profile.host,
			profile.port,
			profile.user,
			profile.identityFile,
			profile.backendId,
			profile.namespaceId,
			profile.serviceUid,
		],
	);
}

export async function runConfirmedRemoteControl<T>(options: {
	getProfile(): ConnectionProfile | null;
	confirm(): Promise<boolean>;
	control(): Promise<T>;
}): Promise<T | { status: "cancelled" }> {
	const profile = options.getProfile();
	if (!profile) throw new Error("The remote connection is missing");
	const original = destination(profile);
	if (!(await options.confirm())) return { status: "cancelled" };
	if (destination(options.getProfile()) !== original)
		throw new Error("The remote destination changed; choose the action again");
	return options.control();
}
