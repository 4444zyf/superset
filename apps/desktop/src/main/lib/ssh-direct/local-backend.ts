import {
	LocalBackend,
	type LocalBackendOptions,
} from "@superset/direct-connection";

export function createLocalBackend(
	options: Pick<
		LocalBackendOptions,
		| "dataDir"
		| "execPath"
		| "supervisorPath"
		| "hostServicePath"
		| "migrationsFolder"
		| "chatMigrationsFolder"
	>,
): LocalBackend {
	return new LocalBackend({ ...options, environment: process.env });
}
