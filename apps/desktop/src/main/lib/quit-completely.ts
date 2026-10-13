import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import { dialog } from "electron";
import { quitAppCompletely } from "main/legacy-cloud";

const productName = PRODUCT_BRAND.displayName;

export async function confirmAndQuitCompletely(): Promise<void> {
	try {
		const { response } = await dialog.showMessageBox({
			type: "warning",
			buttons: [
				i18n._(
					msg({
						message: "Quit Completely",
					}),
				),
				i18n._(msg({ message: "Cancel" })),
			],
			defaultId: 1,
			cancelId: 1,
			title: i18n._(msg`Quit ${productName} Completely`),
			message: i18n._(
				msg`Quit ${productName} and stop all background services?`,
			),
			detail: i18n._(
				msg`All open terminal sessions will be killed and any running host-services will be stopped. Use “Close ${productName}” instead if you want services to keep running for the next launch.`,
			),
		});
		if (response === 0) {
			quitAppCompletely();
		}
	} catch (error) {
		console.error("[quit] Quit-completely confirmation failed:", error);
	}
}
