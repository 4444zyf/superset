import { useLingui } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import { useEffect, useState } from "react";
import type { DirectSetupSnapshot } from "../../../../../shared/direct-workstation";

export function SetupProgress({ snapshot }: { snapshot: DirectSetupSnapshot }) {
	const { t, i18n } = useLingui();
	const [elapsed, setElapsed] = useState(snapshot.elapsedMs);
	useEffect(() => {
		setElapsed(snapshot.elapsedMs);
		if (snapshot.status !== "running") return;
		const started = performance.now();
		const timer = setInterval(
			() => setElapsed(snapshot.elapsedMs + performance.now() - started),
			250,
		);
		return () => clearInterval(timer);
	}, [snapshot]);
	const phases = {
		connecting: t({ message: "Connecting" }),
		probing: t({ message: "Checking remote environment" }),
		"checking-release": t({ message: "Verifying backend package" }),
		"preparing-upload": t({ message: "Preparing backend upload" }),
		uploading: t({ message: "Uploading backend" }),
		installing: t({ message: "Verifying and installing backend" }),
		forwarding: t({ message: "Creating secure connection" }),
		verifying: t({ message: "Verifying backend connection" }),
	};
	const label =
		snapshot.status === "completed"
			? t({ message: "Connected" })
			: snapshot.status === "failed"
				? t({ message: "Connection failed" })
				: phases[snapshot.phase];
	const seconds = formatNumber(
		elapsed / 1000,
		{ maximumFractionDigits: 1 },
		i18n.locale,
	);
	return (
		<div className="ws-setup-progress" data-setup-status={snapshot.status}>
			<p aria-live="polite">{label}</p>
			<p aria-live="off">{t`Elapsed: ${seconds} s`}</p>
		</div>
	);
}
