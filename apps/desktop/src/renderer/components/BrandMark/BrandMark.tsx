import { BRAND_MARK, PRODUCT_BRAND } from "@superset/shared/product-brand";
import { type SVGProps, useId } from "react";

export function BrandMark({
	decorative = true,
	...props
}: SVGProps<SVGSVGElement> & { decorative?: boolean }) {
	const maskId = `brand-${useId().replaceAll(":", "")}`;
	return (
		<svg
			{...props}
			viewBox={BRAND_MARK.viewBox}
			fill="currentColor"
			aria-hidden={decorative || undefined}
			role={decorative ? undefined : "img"}
			aria-label={decorative ? undefined : PRODUCT_BRAND.displayName}
		>
			<defs>
				<mask
					id={maskId}
					maskUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="32"
					height="32"
					style={{ maskType: "luminance" }}
				>
					<image width="32" height="32" href={BRAND_MARK.maskDataUri} />
				</mask>
			</defs>
			<rect width="32" height="32" mask={`url(#${maskId})`} />
		</svg>
	);
}
