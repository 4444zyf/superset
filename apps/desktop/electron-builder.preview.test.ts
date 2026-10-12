import { expect, test } from "bun:test";
import baseConfig from "./electron-builder";
import previewConfig from "./electron-builder.preview";

test("a development preview has a separate persisted app identity and retains the explicit packaging guard", () => {
	expect(previewConfig.extraMetadata?.productName).toBe("Superset SSH Preview");
	expect(previewConfig.appId).not.toBe(baseConfig.appId);
	expect(previewConfig.beforePack).toBe(baseConfig.beforePack);
	expect(previewConfig.publish).toBeNull();
	expect(previewConfig.extraResources).not.toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				from: "dist/resources/direct-backend",
			}),
		]),
	);
});
