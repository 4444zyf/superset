import { expect, test } from "bun:test";
import { importSelectedLocalData } from "./import-local-data";

test("cancelling the source picker or confirmation never imports local data", async () => {
	let imports = 0;
	for (const source of [null, "/legacy/namespace"]) {
		const result = await importSelectedLocalData({
			chooseSource: async () => source,
			confirmSource: async () => false,
			importData: async () => {
				imports += 1;
			},
		});
		expect(result).toEqual({ status: "cancelled" });
	}
	expect(imports).toBe(0);
});

test("the importer receives only the main-owned selected source after explicit confirmation", async () => {
	const actions: string[] = [];
	const result = await importSelectedLocalData({
		chooseSource: async () => {
			actions.push("choose");
			return "/legacy/namespace";
		},
		confirmSource: async (source) => {
			actions.push(`confirm:${source}`);
			return true;
		},
		importData: async (source) => {
			actions.push(`import:${source}`);
			return { projects: 2, workspaces: 4 };
		},
	});
	expect(actions).toEqual([
		"choose",
		"confirm:/legacy/namespace",
		"import:/legacy/namespace",
	]);
	expect(result).toEqual({ projects: 2, workspaces: 4 });
});
