export async function captureCurrentPage<TImage, TResult>({
	current,
	capture,
	commit,
}: {
	current(): boolean;
	capture(): Promise<TImage>;
	commit(image: TImage): TResult;
}): Promise<{ status: "saved"; result: TResult } | { status: "stale" }> {
	if (!current()) return { status: "stale" };
	let image: TImage;
	try {
		image = await capture();
	} catch (error) {
		if (!current()) return { status: "stale" };
		throw error;
	}
	if (!current()) return { status: "stale" };
	return { status: "saved", result: commit(image) };
}
