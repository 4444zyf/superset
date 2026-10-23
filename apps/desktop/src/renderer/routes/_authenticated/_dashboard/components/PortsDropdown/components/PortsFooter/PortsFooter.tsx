import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { useDashboardSidebarPortKill } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useDashboardSidebarPortKill";
import type { DashboardSidebarPortGroup } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useDashboardSidebarPortsData";
import { PortsFooterView } from "./components/PortsFooterView";

interface PortsFooterProps {
	groups: DashboardSidebarPortGroup[];
	totalPortCount: number;
}

/** Dropdown footer: live-port total plus close-all across every workspace. */
export function PortsFooter({ groups, totalPortCount }: PortsFooterProps) {
	const { t } = useLingui();
	const { isPending, killPorts } = useDashboardSidebarPortKill();

	const handleCloseAll = async () => {
		if (isPending) return;
		const results = await killPorts(groups.flatMap((group) => group.ports));
		const closedCount = results.filter((result) => result.success).length;
		if (closedCount > 0) {
			toast.success(
				t({
					message: plural(closedCount, {
						one: "Closed # port",
						other: "Closed # ports",
					}),
				}),
			);
		}
	};

	return (
		<PortsFooterView
			totalPortCount={totalPortCount}
			isPending={isPending}
			onCloseAll={() => void handleCloseAll()}
		/>
	);
}
