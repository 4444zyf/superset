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
	extraResources: baseConfig.extraResources?.filter(
		(resource) =>
			typeof resource === "string" ||
			(resource.from !== "dist/resources/direct-backend" &&
				resource.from !== "dist/resources/direct-release-keys.json"),
	),
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
