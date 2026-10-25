import { z } from "zod";
import {
	DEFAULT_PORT_OPEN_ACTION,
	DEFAULT_URL_LINKS,
	linkActionSchema,
	linkTierMapSchema,
} from "./browser-link-policy";

export const browserLinkActionSchema = linkActionSchema.exclude(["rightPane"]);
export const browserLinkTierMapSchema = linkTierMapSchema
	.extend({
		plain: browserLinkActionSchema.nullable(),
		shift: browserLinkActionSchema.nullable(),
		meta: browserLinkActionSchema.nullable(),
		metaShift: browserLinkActionSchema.nullable(),
	})
	.strict();
export const browserPreferenceValuesSchema = z.strictObject({
	homepageUrl: z
		.string()
		.trim()
		.max(8192)
		.nullable()
		.transform((value) => value || null),
	urlLinks: browserLinkTierMapSchema,
	portOpenAction: browserLinkActionSchema,
});
export const browserPreferencePatchSchema =
	browserPreferenceValuesSchema.partial();
export type BrowserPreferenceValues = z.infer<
	typeof browserPreferenceValuesSchema
>;
export type BrowserPreferencePatch = z.infer<
	typeof browserPreferencePatchSchema
>;
export type BrowserLinkAction = z.infer<typeof browserLinkActionSchema>;

export interface BrowserPreferenceSnapshot {
	schemaVersion: 1;
	revision: number;
	invalid: boolean;
	values: BrowserPreferenceValues;
}
export interface BrowserPreferenceApi {
	get(): Promise<BrowserPreferenceSnapshot>;
	update(input: {
		expectedRevision: number;
		patch: BrowserPreferencePatch;
	}): Promise<BrowserPreferenceSnapshot>;
	reset(input: {
		expectedRevision: number;
	}): Promise<BrowserPreferenceSnapshot>;
}
export function defaultBrowserPreferenceValues(): BrowserPreferenceValues {
	return browserPreferenceValuesSchema.parse({
		homepageUrl: null,
		urlLinks: DEFAULT_URL_LINKS,
		portOpenAction: DEFAULT_PORT_OPEN_ACTION,
	});
}
