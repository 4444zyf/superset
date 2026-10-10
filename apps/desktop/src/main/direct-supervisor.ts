import { resolve } from "node:path";
import { runDirectSupervisor } from "@superset/host-service/direct-supervisor";

const index = process.argv.indexOf("--config");
const configPath = process.argv[index + 1];
if (index < 0 || !configPath)
	throw new Error("A local supervisor config path is required");
void runDirectSupervisor(resolve(configPath)).catch((error) => {
	console.error("[local-supervisor]", error);
	process.exit(1);
});
