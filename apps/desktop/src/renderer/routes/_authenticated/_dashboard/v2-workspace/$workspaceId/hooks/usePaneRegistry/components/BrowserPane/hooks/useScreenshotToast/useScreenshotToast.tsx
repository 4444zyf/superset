import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
export function useScreenshotToast(onViewAll: () => void) {
	const { t } = useLingui();
	return {
		success: (base64: string) => {
			toast.success(
				t({
					message: "Screenshot copied to clipboard",
				}),
				{
					description: (
						<img
							src={`data:image/png;base64,${base64}`}
							alt={t({
								message: "Screenshot preview",
							})}
							className="mt-1 max-h-32 w-full rounded border border-border object-contain"
						/>
					),
					action: {
						label: t({
							message: "View all",
						}),
						onClick: onViewAll,
					},
				},
			);
		},
		error: () => {
			toast.error(
				t({
					message: "Could not take a screenshot",
				}),
			);
		},
	};
}
