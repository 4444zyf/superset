import { middleware } from "@superset/cli-framework";
import { trackCommandInvoked } from "../lib/analytics";
import { createUnavailableApiClient } from "../lib/api-client";
import { resolveAuth } from "../lib/resolve-auth";

export default middleware(async (opts) => {
	if (typeof opts.options.namespace === "string")
		return opts.next({
			ctx: {
				api: createUnavailableApiClient(),
				config: {},
				bearer: "",
				authSource: "direct",
			},
		});
	const options = opts.options as { apiKey?: string };
	const { config, api, bearer, authSource } = await resolveAuth(options.apiKey);

	trackCommandInvoked({
		api,
		commandPath: opts.commandPath,
		flags: Object.keys(opts.options).filter(
			(k) => opts.options[k] !== undefined,
		),
	});

	return opts.next({
		ctx: { api, config, bearer, authSource },
	});
});
