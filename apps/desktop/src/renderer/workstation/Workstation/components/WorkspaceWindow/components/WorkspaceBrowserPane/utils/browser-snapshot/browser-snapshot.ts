export function subscribeBrowserSnapshot<TRow>(
	api: {
		getSnapshot(): Promise<{ revision: number; rows: TRow[] }>;
		onChanged(
			listener: (snapshot: { revision: number; rows: TRow[] }) => void,
		): () => void;
	},
	onData: (rows: TRow[]) => void,
	onError: () => void,
): () => void {
	let active = true,
		revision = -1;
	const accept = (snapshot: { revision: number; rows: TRow[] }) => {
		if (!active || snapshot.revision < revision) return;
		revision = snapshot.revision;
		onData(snapshot.rows);
	};
	const stop = api.onChanged(accept);
	void api.getSnapshot().then(accept, () => {
		if (active && revision < 0) onError();
	});
	return () => {
		active = false;
		stop();
	};
}
