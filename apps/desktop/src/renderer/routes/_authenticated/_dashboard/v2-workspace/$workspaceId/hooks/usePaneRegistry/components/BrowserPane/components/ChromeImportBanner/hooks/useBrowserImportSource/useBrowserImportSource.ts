import { useEffect, useState } from "react";
import type { BrowserImportApi } from "shared/browser-import";

type Source = Pick<BrowserImportApi, "getSources">;
type Profile = { browserKey: string; browserName: string };
export function useBrowserImportSource(source: Source | undefined) {
	const [current, setCurrent] = useState<{
		source: Source;
		profile: Profile | null;
	} | null>(null);
	useEffect(() => {
		if (!source) {
			setCurrent(null);
			return;
		}
		let cancelled = false;
		void source
			.getSources()
			.then((result) => {
				if (cancelled) return;
				const profile = result.sources[0];
				setCurrent({
					source,
					profile: profile
						? {
								browserKey: profile.browserKey,
								browserName: profile.browserName,
							}
						: null,
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [source]);
	return current?.source === source ? (current?.profile ?? null) : null;
}
