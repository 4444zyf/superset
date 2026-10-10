export function reportRendererError(
	error: unknown,
	componentStack?: string | null,
) {
	console.error("[renderer] Error boundary caught:", error, componentStack);
}
