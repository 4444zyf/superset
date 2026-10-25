import { expect, test } from "bun:test";
import { captureCurrentPage } from "./capture-current-page";

test("a capture resolved after its page is replaced never writes files or clipboard", async () => {
	let resolve!: (image: string) => void,
		current = true,
		commits = 0;
	const pending = captureCurrentPage({
		current: () => current,
		capture: () =>
			new Promise<string>((done) => {
				resolve = done;
			}),
		commit: () => ++commits,
	});
	current = false;
	resolve("old page pixels");
	expect(await pending).toEqual({ status: "stale" });
	expect(commits).toBe(0);
});
test("a current capture commits pixels and propagates a capture failure", async () => {
	expect(
		await captureCurrentPage({
			current: () => true,
			capture: async () => "pixels",
			commit: (image) => image,
		}),
	).toEqual({ status: "saved", result: "pixels" });
	const failure = new Error("capture failed");
	await expect(
		captureCurrentPage({
			current: () => true,
			capture: async () => {
				throw failure;
			},
			commit: () => {
				throw Error("must not commit");
			},
		}),
	).rejects.toBe(failure);
});
