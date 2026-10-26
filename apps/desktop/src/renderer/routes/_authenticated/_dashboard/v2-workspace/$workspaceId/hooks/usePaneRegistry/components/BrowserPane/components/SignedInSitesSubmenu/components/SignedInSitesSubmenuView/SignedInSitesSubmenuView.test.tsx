import { afterEach, expect, test } from "bun:test";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type {
	BrowserCookieDomain,
	BrowserSiteCookiesApi,
} from "shared/browser-site-cookies";
import { SignedInSitesSubmenuView } from "./SignedInSitesSubmenuView";

afterEach(cleanup);
function Menu({ source }: { source: BrowserSiteCookiesApi }) {
	return (
		<DropdownMenu open>
			<DropdownMenuTrigger>Menu</DropdownMenuTrigger>
			<DropdownMenuContent>
				<SignedInSitesSubmenuView source={source} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
async function open() {
	await act(async () =>
		fireEvent.keyDown(
			screen.getByRole("menuitem", { name: "Signed-in sites" }),
			{ key: "ArrowRight" },
		),
	);
}
const row = (domain: string): BrowserCookieDomain => ({
	domain,
	cookieCount: 2,
});
test("the original site search caps visible rows and keyboard selection forgets only the chosen domain", async () => {
	let domains = Array.from({ length: 25 }, (_, i) =>
			row(`site-${i}.owned.test`),
		),
		reads = 0;
	const forgotten: unknown[] = [];
	const source: BrowserSiteCookiesApi = {
		getDomains: async () => {
			reads++;
			return domains;
		},
		forget: async (input) => {
			forgotten.push(input);
			domains = domains.filter((row) => row.domain !== input.domain);
			return { success: true };
		},
	};
	render(<Menu source={source} />);
	expect(reads).toBe(0);
	await open();
	expect(screen.getAllByRole("button", { name: /^Forget / }).length).toBe(20);
	const input = screen.getByPlaceholderText("Search 25 sites…");
	fireEvent.change(input, { target: { value: "SITE-24" } });
	expect(screen.getAllByRole("button", { name: /^Forget / }).length).toBe(1);
	input.focus();
	fireEvent.keyDown(input, { key: "ArrowDown" });
	expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
	await act(async () =>
		fireEvent.keyDown(document.activeElement!, { key: "Enter" }),
	);
	expect(forgotten).toEqual([{ domain: "site-24.owned.test" }]);
	expect(reads).toBe(2);
	expect(domains.length).toBe(24);
	expect(screen.getByText("No matches")).toBeTruthy();
});
test("a cookie read error is visible and Retry reloads the submenu", async () => {
	let reads = 0;
	const source: BrowserSiteCookiesApi = {
		getDomains: async () => {
			if (++reads === 1) throw Error("Owned read unavailable");
			return [row("owned.test")];
		},
		forget: async () => ({ success: true }),
	};
	render(<Menu source={source} />);
	await open();
	expect(screen.getByRole("alert").textContent).toBe("An error occurred");
	expect(screen.queryByText("No sites are signed in")).toBeNull();
	await act(async () =>
		fireEvent.keyDown(screen.getByRole("menuitem", { name: "Retry" }), {
			key: "Enter",
		}),
	);
	expect(
		screen.getByRole("button", { name: "Forget owned.test" }),
	).toBeTruthy();
	expect(reads).toBe(2);
});
test("a late domain list from the previous source does not replace the current submenu", async () => {
	let resolve!: (rows: BrowserCookieDomain[]) => void;
	const source: BrowserSiteCookiesApi = {
		getDomains: () =>
			new Promise((r) => {
				resolve = r;
			}),
		forget: async () => ({ success: true }),
	};
	const replacement: BrowserSiteCookiesApi = {
		getDomains: async () => [row("new.owned.test")],
		forget: async () => ({ success: true }),
	};
	const view = render(<Menu source={source} />);
	await open();
	await act(async () => view.rerender(<Menu source={replacement} />));
	await act(async () => resolve([row("old.owned.test")]));
	expect(
		screen.getByRole("button", { name: "Forget new.owned.test" }),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Forget old.owned.test" }),
	).toBeNull();
});
test("an old forget completion cannot reload a newly selected source", async () => {
	let finish!: (result: { success: boolean }) => void,
		reads = 0;
	const source: BrowserSiteCookiesApi = {
		getDomains: async () => [row("old.owned.test")],
		forget: () =>
			new Promise((r) => {
				finish = r;
			}),
	};
	const replacement: BrowserSiteCookiesApi = {
		getDomains: async () => {
			reads++;
			return [row("new.owned.test")];
		},
		forget: async () => ({ success: true }),
	};
	const view = render(<Menu source={source} />);
	await open();
	await act(async () =>
		fireEvent.keyDown(
			screen.getByRole("menuitem", { name: /old\.owned\.test/ }),
			{ key: "Enter" },
		),
	);
	await act(async () => view.rerender(<Menu source={replacement} />));
	await act(async () => finish({ success: true }));
	expect(reads).toBe(1);
	expect(
		screen.getByRole("button", { name: "Forget new.owned.test" }),
	).toBeTruthy();
});
