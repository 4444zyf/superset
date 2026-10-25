import { z } from "zod";

export const linkActionSchema = z.enum([
	"pane",
	"newTab",
	"external",
	"rightPane",
]);

export type LinkAction = z.infer<typeof linkActionSchema>;

export const linkTierMapSchema = z.object({
	plain: linkActionSchema.nullable(),
	shift: linkActionSchema.nullable(),
	meta: linkActionSchema.nullable(),
	metaShift: linkActionSchema.nullable(),
});

export type LinkTierMap = z.infer<typeof linkTierMapSchema>;
export type LinkTier = keyof LinkTierMap;

export const DEFAULT_URL_LINKS: LinkTierMap = {
	plain: null,
	shift: "newTab",
	meta: "pane",
	metaShift: "external",
};

export const DEFAULT_PORT_OPEN_ACTION: LinkAction = "external";
