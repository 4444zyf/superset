import { msg } from "@lingui/core/macro";
import { string } from "@superset/cli-framework";
import { i18n, initI18n } from "@superset/i18n";

export function namespaceOption() {
	if (!i18n.locale) initI18n();
	return string().desc(i18n._(msg({ message: "Local namespace" })));
}
