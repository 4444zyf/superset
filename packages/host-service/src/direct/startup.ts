export async function prepareDirectRuntime(
	maintenance: { frozen: boolean },
	initializeTerminals: () => Promise<unknown>,
): Promise<void> {
	if (!maintenance.frozen) await initializeTerminals();
}
