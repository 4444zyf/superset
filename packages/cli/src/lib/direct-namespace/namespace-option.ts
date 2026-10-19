import { msg } from "@lingui/core/macro";
import { string } from "@superset/cli-framework";
import { i18n } from "@superset/i18n";

export function namespaceOption() {
	return string().desc(i18n._(msg({ message: "Local namespace" })));
}
