import { startWorkstation } from "./direct-app";

void startWorkstation().catch((error) => {
	console.error("[workstation] Startup failed:", error);
});
