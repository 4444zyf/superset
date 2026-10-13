import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import { BrandMark } from "../../../../components/BrandMark";

/** Legacy account UI: product artwork is the fork's; account services remain upstream. */
export function SupersetLogo({
	className,
}: {
	className?: string;
	gradient?: boolean;
}) {
	return (
		<span
			className={className}
			style={{ display: "inline-flex", alignItems: "center", gap: 12 }}
		>
			<BrandMark style={{ width: 36, height: 36 }} />
			<span>{PRODUCT_BRAND.displayName}</span>
		</span>
	);
}
