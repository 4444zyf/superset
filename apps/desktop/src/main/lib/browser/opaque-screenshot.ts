export function opaqueScreenshot(
	image: Electron.NativeImage,
	fromBitmap: (
		bitmap: Buffer,
		size: { width: number; height: number },
	) => Electron.NativeImage,
): Electron.NativeImage {
	const bitmap = image.toBitmap(),
		size = image.getSize();
	if (bitmap.length !== size.width * size.height * 4)
		throw Error("Unexpected screenshot bitmap size");
	let changed = false;
	// Electron returns premultiplied BGRA pixels; an unset webview canvas is transparent.
	for (let index = 0; index < bitmap.length; index += 4) {
		const alpha = bitmap[index + 3];
		if (alpha === 255) continue;
		changed = true;
		for (let channel = 0; channel < 3; channel++)
			bitmap[index + channel] = Math.min(
				255,
				bitmap[index + channel] + 255 - alpha,
			);
		bitmap[index + 3] = 255;
	}
	return changed ? fromBitmap(bitmap, size) : image;
}
