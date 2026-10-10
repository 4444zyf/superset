import { TRPCError } from "@trpc/server";
import type { ApiClient } from "../types";

export function requireCloudApi(api: ApiClient | null): ApiClient {
	if (!api)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"This capability requires a Superset cloud account and is unavailable on a direct backend",
		});
	return api;
}
