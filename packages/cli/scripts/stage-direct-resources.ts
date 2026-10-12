import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	parseDirectReleaseKeys,
	stageDirectResources,
	verifyDirectResources,
} from "./direct-release-resources";

function argument(name: string): string {
	const result = process.argv
		.find((value) => value.startsWith(`--${name}=`))
		?.slice(name.length + 3);
	if (!result) throw new Error(`Missing required --${name}=...`);
	return result;
}

export function stageDirectResourcesCommand(): void {
	const configured = process.env.DIRECT_RELEASE_PUBLIC_KEYS_JSON;
	if (!configured)
		throw new Error(
			"DIRECT_RELEASE_PUBLIC_KEYS_JSON is required for a signed desktop release",
		);
	const trustedKeys = parseDirectReleaseKeys(JSON.parse(configured));
	const expectedVersion = JSON.parse(
		readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"),
	).version as string;
	const resourcesDir = resolve(argument("resources-dir"));
	if (process.argv.includes("--verify"))
		verifyDirectResources({ resourcesDir, expectedVersion, trustedKeys });
	else {
		const input = resolve(argument("input-dir"));
		stageDirectResources({
			resourcesDir,
			expectedVersion,
			trustedKeys,
			releaseRoots: {
				"darwin-arm64": join(input, "darwin-arm64"),
				"darwin-x64": join(input, "darwin-x64"),
			},
		});
	}
	console.log(
		"[direct-resources] complete signed arm64 and x64 backends verified",
	);
}
if (import.meta.main) stageDirectResourcesCommand();
