import type { Session } from "electron";
export async function clearBrowserSessionData(
	ses: Pick<Session, "clearStorageData" | "clearCache">,
	input: { type: "cookies" | "cache" | "storage" | "all" },
) {
	switch (input.type) {
		case "cookies":
			await ses.clearStorageData({ storages: ["cookies"] });
			break;
		case "cache":
			await ses.clearCache();
			break;
		case "storage":
			await ses.clearStorageData({
				storages: ["localstorage", "indexdb"],
			});
			break;
		case "all":
			await ses.clearStorageData();
			await ses.clearCache();
			break;
	}
	return { success: true };
}
