import { Trans } from "@lingui/react/macro";
import {
	BRAND_LINKS,
	type BrandLinkId,
	PRODUCT_BRAND,
} from "@superset/shared/product-brand";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { useEffect, useState } from "react";
import type { ProductAboutInfo } from "../../../../../shared/direct-workstation";
import { BrandMark } from "../../../../components/BrandMark";

export function AboutDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	const [info, setInfo] = useState<ProductAboutInfo>();
	const [error, setError] = useState<string>();
	const productName = PRODUCT_BRAND.displayName;
	useEffect(() => {
		if (!open) return;
		let active = true;
		window.directWorkstation.about().then(
			(value) => {
				if (active) setInfo(value);
			},
			(problem) => {
				if (active) setError(String(problem));
			},
		);
		return () => {
			active = false;
		};
	}, [open]);
	const linkLabels = {
		source: <Trans>Fork source code</Trans>,
		feedback: <Trans>Report a fork issue</Trans>,
		downloads: <Trans>Fork downloads</Trans>,
		upstream: <Trans>Superset upstream source</Trans>,
		upstreamDocs: <Trans>Superset upstream documentation</Trans>,
	};
	return (
		<Dialog modal open={open} onOpenChange={onOpenChange}>
			<DialogContent className="ws-about w-[min(640px,calc(100vw-32px))] max-w-none sm:max-w-none">
				<DialogHeader>
					<DialogTitle>
						<Trans>About {productName}</Trans>
					</DialogTitle>
				</DialogHeader>
				<div className="ws-about-brand">
					<BrandMark />
					<strong>{productName}</strong>
				</div>
				<DialogDescription>
					<Trans>
						An unofficial modified version of Superset, independently maintained
						without endorsement from Superset, Inc. Original copyright and
						Elastic License 2.0 are preserved.
					</Trans>
				</DialogDescription>
				{info && (
					<p className="ws-about-version">
						<Trans>Version</Trans> {info.version}
						{info.source && (
							<code title={info.source}>{info.source.slice(0, 12)}</code>
						)}
					</p>
				)}
				<nav className="ws-about-links">
					{(Object.keys(BRAND_LINKS) as BrandLinkId[]).map((id) => (
						<button
							key={id}
							type="button"
							onClick={() =>
								window.directWorkstation
									.openBrandLink(id)
									.catch((problem) => setError(String(problem)))
							}
						>
							{linkLabels[id]}
						</button>
					))}
				</nav>
				<p>{PRODUCT_BRAND.upstreamCopyright}</p>
				{error && <p role="alert">{error}</p>}
				{info && (
					<>
						<details>
							<summary>
								<Trans>Modification notice</Trans>
							</summary>
							<pre>{info.notice}</pre>
						</details>
						<details>
							<summary>
								<Trans>Full original license</Trans>
							</summary>
							<pre>{info.license}</pre>
						</details>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
