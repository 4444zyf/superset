export function decodeTerminalBinaryInput(value: unknown): Buffer | null {
	if (
		typeof value !== "string" ||
		value.length > 65536 ||
		value.length % 4 !== 0 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			value,
		)
	)
		return null;
	return Buffer.from(value, "base64");
}
