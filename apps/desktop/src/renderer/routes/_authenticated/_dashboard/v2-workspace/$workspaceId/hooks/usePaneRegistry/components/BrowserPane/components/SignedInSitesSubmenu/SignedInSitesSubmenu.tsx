import { electronTrpcClient } from "renderer/lib/trpc-client";
import { SignedInSitesSubmenuView } from "./components/SignedInSitesSubmenuView";

const source = {
	getDomains: () => electronTrpcClient.browser.getCookieDomains.query(),
	forget: (input: { domain: string }) =>
		electronTrpcClient.browser.clearCookiesForDomain.mutate(input),
};
export function SignedInSitesSubmenu() {
	return <SignedInSitesSubmenuView source={source} />;
}
