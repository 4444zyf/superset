import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Configuration } from "electron-builder";
import baseConfig from "./electron-builder";

const productName = "Superset SSH Preview";
const config: Configuration = {
	...baseConfig,
	appId: "com.superset.desktop.ssh-preview",
	productName,
	extraMetadata: {
		...baseConfig.extraMetadata,
		name: "superset-ssh-preview",
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
	protocols: { name: productName, schemes: ["superset-ssh-preview"] },
	mac: {
		...baseConfig.mac,
		target: ["dmg"],
		identity: "-",
		notarize: false,
		hardenedRuntime: false,
		artifactName: `Superset-SSH-Preview-\${version}-\${arch}.\${ext}`,
		extendInfo: {
			...baseConfig.mac?.extendInfo,
			CFBundleName: productName,
			CFBundleDisplayName: productName,
		},
	},
};

export default config;
