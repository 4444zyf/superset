import { Trans } from "@lingui/react/macro";
import { VscLoading, VscRepoPush } from "react-icons/vsc";

export function PushButton({
	className,
	isPushing,
	disabled = false,
	onClick,
}: {
	className?: string;
	isPushing: boolean;
	disabled?: boolean;
	onClick(): void;
}) {
	return (
		<button
			type="button"
			className={className}
			disabled={disabled || isPushing}
			onClick={onClick}
		>
			{isPushing ? (
				<VscLoading className="size-3.5 animate-spin" />
			) : (
				<VscRepoPush className="size-3.5" />
			)}
			<Trans>Push</Trans>
		</button>
	);
}
