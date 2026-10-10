export const INSTALL_RESERVE_BYTES = 256 * 1024 * 1024;
export function parseDiskFreeBytes(output: string): number {
	const match = output
		.trim()
		.split("\n")
		.at(-1)
		?.match(/\s+\d+\s+\d+\s+(\d+)\s+\d+%\s+/);
	const bytes = Number(match?.[1]) * 1024;
	if (!match || !Number.isSafeInteger(bytes) || bytes < 0)
		throw new Error("Cannot determine available disk space");
	return bytes;
}
export function assertReleaseCapacity(
	payloadBytes: number,
	availableBytes: number,
	copies = 3,
): void {
	if (
		!Number.isSafeInteger(payloadBytes) ||
		payloadBytes < 0 ||
		payloadBytes > 8 * 1024 * 1024 * 1024 ||
		!Number.isSafeInteger(availableBytes) ||
		availableBytes < 0 ||
		!Number.isSafeInteger(copies) ||
		copies < 1 ||
		copies > 3
	)
		throw new Error("Invalid release disk capacity estimate");
	if (availableBytes < payloadBytes * copies + INSTALL_RESERVE_BYTES)
		throw new Error(
			"Not enough disk space for a verified transactional backend installation",
		);
}
