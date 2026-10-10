export async function importSelectedLocalData<T>(options: {
	chooseSource(): Promise<string | null>;
	confirmSource(source: string): Promise<boolean>;
	importData(source: string): Promise<T>;
}): Promise<T | { status: "cancelled" }> {
	const source = await options.chooseSource();
	if (!source || !(await options.confirmSource(source)))
		return { status: "cancelled" };
	return options.importData(source);
}
