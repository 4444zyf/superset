import { BRAND_MARK, PRODUCT_BRAND } from "@superset/shared/product-brand";
import type { SVGProps } from "react";

export function BrandMark({
	decorative = true,
	...props
}: SVGProps<SVGSVGElement> & { decorative?: boolean }) {
	return (
		<svg
			{...props}
			viewBox={BRAND_MARK.viewBox}
			fill="currentColor"
			aria-hidden={decorative || undefined}
			role={decorative ? undefined : "img"}
			aria-label={decorative ? undefined : PRODUCT_BRAND.displayName}
		>
			{BRAND_MARK.paths.map((d) => (
				<path key={d} d={d} />
			))}
		</svg>
	);
}
