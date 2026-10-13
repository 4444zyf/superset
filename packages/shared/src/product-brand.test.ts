import { expect, test } from "bun:test";
import { BRAND_LINKS, resolveBrandLink } from "./product-brand";

test("product links accept only known IDs and never renderer-supplied URLs", () => {
	for (const id of Object.keys(BRAND_LINKS))
		expect(new URL(resolveBrandLink(id)).protocol).toBe("https:");
	for (const input of [
		"javascript:alert(1)",
		"https://example.org",
		"__proto__",
		"toString",
		{ source: true },
		null,
	])
		expect(() => resolveBrandLink(input)).toThrow("Unknown product link");
});
