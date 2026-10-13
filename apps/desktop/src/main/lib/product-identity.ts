import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PRODUCT_BRAND } from "@superset/shared/product-brand";

interface ProductApplication {
	isPackaged: boolean;
	getPath(name: "appData"): string;
	getAppPath(): string;
	setName(name: string): void;
	setPath(name: "userData" | "sessionData", value: string): void;
	requestSingleInstanceLock(): boolean;
}

/** Fresh fork profiles: installed product and individual dev workspaces are isolated. */
export function lockProductProfile(
	app: ProductApplication,
	workspaceId?: string,
): boolean {
	const profile = path.join(
		app.getPath("appData"),
		app.isPackaged
			? PRODUCT_BRAND.desktopDataProfile
			: `${PRODUCT_BRAND.slug}-dev-${createHash("sha256")
					.update(workspaceId?.trim() || app.getAppPath())
					.digest("hex")}`,
	);
	mkdirSync(profile, { recursive: true, mode: 0o700 });
	app.setName(PRODUCT_BRAND.displayName);
	app.setPath("userData", profile);
	app.setPath("sessionData", profile);
	return app.requestSingleInstanceLock();
}
