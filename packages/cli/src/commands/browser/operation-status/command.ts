import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { z } from "zod";
import { command } from "../../../lib/command";
import {
	namespaceOption,
	readFromDirectNamespace,
} from "../../../lib/direct-namespace";
import { operationIdOption } from "../../../lib/direct-namespace/browser-navigation";

export default command({
	description: i18n._(
		msg({ message: "Inspect a durable namespace operation" }),
	),
	options: {
		namespace: namespaceOption().required(),
		operationId: operationIdOption().required(),
	},
	run: async ({ options }) => {
		const operationId = z.string().uuid().parse(options.operationId);
		const direct = await readFromDirectNamespace(options, (target) =>
			target.client.direct.operationStatus.query({ operationId }),
		);
		const receipt = direct!.value;
		return {
			data: receipt,
			message: receipt
				? `${receipt.operationId}\t${receipt.procedure}\t${receipt.status}`
				: i18n._(msg({ message: "Operation not found" })),
		};
	},
});
