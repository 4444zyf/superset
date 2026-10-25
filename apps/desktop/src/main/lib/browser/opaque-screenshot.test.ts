import { expect, test } from "bun:test";
import { opaqueScreenshot } from "./opaque-screenshot";

test("transparent and translucent browser pixels use a white canvas while opaque colors stay exact", () => {
	const pixels = Buffer.from([0, 0, 0, 0, 64, 32, 16, 128, 130, 90, 40, 255]);
	const image = {
		getSize: () => ({ width: 3, height: 1 }),
		toBitmap: () => Buffer.from(pixels),
	} as unknown as Electron.NativeImage;
	const output = {} as Electron.NativeImage;
	expect(
		opaqueScreenshot(image, (bitmap, size) => {
			expect(size).toEqual({ width: 3, height: 1 });
			expect([...bitmap]).toEqual([
				255, 255, 255, 255, 191, 159, 143, 255, 130, 90, 40, 255,
			]);
			return output;
		}),
	).toBe(output);
	expect([...pixels]).toEqual([0, 0, 0, 0, 64, 32, 16, 128, 130, 90, 40, 255]);
});
