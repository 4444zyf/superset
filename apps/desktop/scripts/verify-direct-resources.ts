import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	parseDirectReleaseKeys,
	verifyDirectResources,
} from "../../../packages/cli/scripts/direct-release-resources";

export function verifyDirectPackaging(options: {
	resourcesDir: string;
	expectedVersion: string;
	keysJson?: string;
	developmentPackage?: boolean;
}): "development" | "signed" {
	if (!options.keysJson && options.developmentPackage) {
		for (const name of ["direct-backend", "direct-release-keys.json"]) {
			try {
				lstatSync(join(options.resourcesDir, name));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			throw new Error(
				"Explicit development packaging requires removing stale backend payload and trust resources from dist/resources",
			);
		}
		return "development";
	}
	if (!options.keysJson)
		throw new Error(
			"A desktop release requires DIRECT_RELEASE_PUBLIC_KEYS_JSON and complete signed backend resources. Local development packaging requires explicit SUPERSET_DIRECT_DEVELOPMENT_PACKAGE=1.",
		);
	verifyDirectResources({
		...options,
		trustedKeys: parseDirectReleaseKeys(JSON.parse(options.keysJson)),
	});
	return "signed";
}
if (import.meta.main) {
	const version = JSON.parse(
		readFileSync(
			resolve(import.meta.dirname, "../../../packages/cli/package.json"),
			"utf8",
		),
	).version as string;
	const mode = verifyDirectPackaging({
		resourcesDir: resolve(import.meta.dirname, "../dist/resources"),
		expectedVersion: version,
		keysJson: process.env.DIRECT_RELEASE_PUBLIC_KEYS_JSON,
		developmentPackage:
			!process.argv.includes("--require-signed") &&
			process.env.SUPERSET_DIRECT_DEVELOPMENT_PACKAGE === "1",
	});
	console.log(
		`[direct-resources] ${mode === "signed" ? "complete independently trusted backend resources verified" : "explicit development package: managed Mac deployment is unavailable"}`,
	);
}
