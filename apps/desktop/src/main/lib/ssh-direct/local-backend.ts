import {
	type LocalBackendOptions,
	LocalNamespaceBackend,
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
): LocalNamespaceBackend {
	return new LocalNamespaceBackend({ ...options, environment: process.env });
}
