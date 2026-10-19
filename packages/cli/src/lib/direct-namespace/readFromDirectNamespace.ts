import { CLIError } from "@superset/cli-framework";
import { resolveDirectNamespace } from "./resolveDirectNamespace";

export async function readFromDirectNamespace<T>(
	options: { namespace?: string; host?: string },
	read: (
		target: Awaited<ReturnType<typeof resolveDirectNamespace>>,
	) => Promise<T>,
): Promise<{ value: T } | null> {
	if (options.namespace === undefined) return null;
	if (options.host !== undefined)
		throw new CLIError("Pass either --namespace or --host, not both");
	const target = await resolveDirectNamespace(options.namespace);
	return { value: await read(target) };
}
