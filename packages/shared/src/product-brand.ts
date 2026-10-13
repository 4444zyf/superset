import brand from "./product-brand.json" with { type: "json" };
import geometry from "./product-brand-mark.json" with { type: "json" };

/** Product display identity. Service endpoints and compatibility names stay separate. */
export const PRODUCT_BRAND = Object.freeze(brand);
export const BRAND_MARK = Object.freeze(geometry);
export const BRAND_LINKS = Object.freeze({
	source: brand.forkRepository,
	feedback: brand.forkIssues,
	downloads: brand.forkReleases,
	upstream: brand.upstreamRepository,
	upstreamDocs: brand.upstreamDocs,
});
export type BrandLinkId = keyof typeof BRAND_LINKS;

export function resolveBrandLink(id: unknown): string {
	if (typeof id !== "string" || !Object.hasOwn(BRAND_LINKS, id))
		throw new Error("Unknown product link");
	return BRAND_LINKS[id as BrandLinkId];
}
