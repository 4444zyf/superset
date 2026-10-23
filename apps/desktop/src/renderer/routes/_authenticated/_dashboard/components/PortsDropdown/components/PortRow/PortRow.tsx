import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { useDashboardSidebarPortKill } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useDashboardSidebarPortKill";
import type { DashboardSidebarPort } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useDashboardSidebarPortsData";
import { usePortOpenActions } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/usePortOpenActions";
import { usePortForward } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/providers/PortForwardsProvider";
import { formatPortRowLabel } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/utils/formatPortRowLabel";
import { PortForwardBusyActions } from "renderer/routes/_authenticated/_dashboard/components/PortForwardBusyActions";

import { PortRowView } from "./components/PortRowView";

interface PortRowProps {
	port: DashboardSidebarPort;
	// Close the dropdown after an action that moves focus elsewhere (opening
	// the port or jumping to its workspace).
	onNavigate: () => void;
}

/**
 * One port in the top-bar dropdown: a fixed mono port column, the label and
 * process, and a hover-revealed action cluster (open / copy / close).
 */
export function PortRow({ port, onNavigate }: PortRowProps) {
	const { t } = useLingui();
	const { isPending, killPort } = useDashboardSidebarPortKill();
	const { canOpenInBrowser, portUrl, openExternal, openPrimary } =
		usePortOpenActions(port);
	const { copyToClipboard } = useCopyToClipboard();
	const forward = usePortForward(port);
	const address = formatPortRowLabel({ port, forward });

	const description = [port.label, port.processName]
		.filter(Boolean)
		.join(" · ");

	const handleOpen = () => {
		openPrimary();
		onNavigate();
	};

	const handleOpenExternal = () => {
		openExternal();
		onNavigate();
	};

	// Only offered when `portUrl` reaches this machine: a local port, or a
	// remote one the main process forwards.
	const handleCopy = async () => {
		try {
			await copyToClipboard(portUrl);
			toast.success(
				t({
					message: `Copied ${portUrl.replace(/^https?:\/\//, "")}`,
				}),
			);
		} catch {
			toast.error(
				t({
					message: "Failed to copy to clipboard",
				}),
			);
		}
	};

	const handleClose = () => {
		if (isPending) return;
		void killPort(port);
	};

	return (
		<PortRowView
			port={port}
			description={description}
			address={address.text}
			title={address.title}
			isPending={isPending}
			onPrimary={handleOpen}
			onExternal={canOpenInBrowser ? handleOpenExternal : undefined}
			onCopy={canOpenInBrowser ? handleCopy : undefined}
			onClose={handleClose}
			busyActions={
				forward?.status.state === "busy" ? (
					<PortForwardBusyActions forward={forward} />
				) : undefined
			}
		/>
	);
}
