import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import type { Configuration } from "electron-builder";
import baseConfig from "./electron-builder";

const productName = PRODUCT_BRAND.displayName;
const config: Configuration = {
	...baseConfig,
	appId: `${PRODUCT_BRAND.desktopAppId}.preview`,
	productName,
	extraMetadata: {
		...baseConfig.extraMetadata,
		name: PRODUCT_BRAND.slug,
		productName,
	},
	publish: null,
	beforePack: async () => {
		await promisify(execFile)(
			"bun",
			[
				join(__dirname, "scripts/verify-direct-resources.ts"),
				"--require-signed",
			],
			{ cwd: __dirname, env: process.env },
		);
	},
	protocols: [],
	mac: {
		...baseConfig.mac,
		target: ["dmg"],
		identity: "-",
		notarize: false,
		hardenedRuntime: false,
		artifactName: `${PRODUCT_BRAND.artifactStem}-\${version}-\${arch}.\${ext}`,
		extendInfo: {
			...baseConfig.mac?.extendInfo,
			CFBundleName: productName,
			CFBundleDisplayName: productName,
		},
	},
};

export default config;
