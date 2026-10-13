import { expect, test } from "bun:test";
import baseConfig from "./electron-builder";
import previewConfig from "./electron-builder.preview";

test("an SSH preview keeps its isolated app identity and includes both backend payloads and trust outside ASAR", () => {
	expect(previewConfig.extraMetadata?.productName).toBe("Superset Remix");
	expect(previewConfig.appId).not.toBe(baseConfig.appId);
	expect(previewConfig.beforePack).toBeFunction();
	expect(previewConfig.publish).toBeNull();
	expect(previewConfig.extraResources).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				from: "dist/resources/direct-backend",
				to: "resources/direct-backend",
			}),
			expect.objectContaining({
				from: "dist/resources/direct-release-keys.json",
				to: "resources/direct-release-keys.json",
			}),
		]),
	);
});
