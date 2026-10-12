import { Trans, useLingui } from "@lingui/react/macro";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function WorkstationDialog({
	title,
	drawer = false,
	children,
	onClose,
	error,
}: {
	title: string;
	drawer?: boolean;
	children: ReactNode;
	onClose(): void;
	error?: string | null;
}) {
	const { t } = useLingui();
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="workstation-overlay" />
				<Dialog.Content
					className={`workstation-dialog ${drawer ? "is-drawer" : ""}`}
					aria-describedby={undefined}
					onInteractOutside={(event) => event.preventDefault()}
				>
					<div className="ws-dialog-head">
						<Dialog.Title>{title}</Dialog.Title>
						<Dialog.Close
							className="ws-icon-button"
							aria-label={t({ message: "Close" })}
						>
							<X size={18} />
						</Dialog.Close>
					</div>
					{error && (
						<p className="ws-error" role="alert">
							{error}
						</p>
					)}
					{children}
					<Dialog.Description className="sr-only">
						<Trans>Connection settings are stored on this device.</Trans>
					</Dialog.Description>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
