import { afterEach, expect, test } from "bun:test";
import { TooltipProvider } from "@superset/ui/tooltip";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { RemoteFileTree } from "./RemoteFileTree";

afterEach(cleanup);

test("original tree rows expand a remote folder and open its file without replacing siblings", async () => {
	const calls: string[] = [];
	const opened: string[] = [];
	const { container } = render(
		<TooltipProvider>
			<RemoteFileTree
				root="/repo"
				list={async (path) => {
					calls.push(path);
					return path === "/repo"
						? [
								{ absolutePath: "/repo/src", kind: "directory" },
								{ absolutePath: "/repo/note.txt", kind: "file" },
							]
						: [{ absolutePath: "/repo/src/main.ts", kind: "file" }];
				}}
				onOpen={(path) => opened.push(path)}
				onDirectory={() => {}}
				onError={(error) => {
					throw error;
				}}
				refreshKey={0}
			/>
		</TooltipProvider>,
	);
	const row = async (path: string) => {
		let element: HTMLElement | null = null;
		await waitFor(() => {
			element =
				container
					.querySelector("file-tree-container")
					?.shadowRoot?.querySelector<HTMLElement>(
						`[data-item-path="${path}"]`,
					) ?? null;
			expect(element).not.toBeNull();
		});
		return element!;
	};
	fireEvent.click(await row("src/"), { composed: true });
	fireEvent.click(await row("src/main.ts"), { composed: true });
	expect(opened).toEqual(["/repo/src/main.ts"]);
	expect(calls).toEqual(["/repo", "/repo/src"]);
	expect(await row("note.txt")).not.toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Collapse All" }));
	await waitFor(() =>
		expect(
			container
				.querySelector("file-tree-container")
				?.shadowRoot?.querySelector(
					'[data-item-path="src/"]:not([data-file-tree-sticky-row])',
				)
				?.getAttribute("aria-expanded"),
		).toBe("false"),
	);
});
