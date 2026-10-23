import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuLoaderCircle, LuX } from "react-icons/lu";
import { STROKE_WIDTH } from "renderer/screens/main/components/WorkspaceSidebar/constants";
export function PortsFooterView({
	totalPortCount,
	isPending,
	onCloseAll,
}: {
	totalPortCount: number;
	isPending: boolean;
	onCloseAll(): void;
}) {
	const { t } = useLingui();
	return (
		<div
			data-port-footer
			className="flex items-center justify-between border-border border-t px-3 py-1.5"
		>
			<span className="text-[11px] text-muted-foreground">
				{t({
					message: plural(totalPortCount, {
						one: "# live port",
						other: "# live ports",
					}),
				})}
			</span>
			<button
				type="button"
				onClick={onCloseAll}
				disabled={isPending}
				aria-busy={isPending}
				className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-60"
			>
				{isPending ? (
					<LuLoaderCircle
						className="size-3 animate-spin"
						strokeWidth={STROKE_WIDTH}
					/>
				) : (
					<LuX className="size-3" strokeWidth={STROKE_WIDTH} />
				)}
				<Trans>Close all</Trans>
			</button>
		</div>
	);
}
