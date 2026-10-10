import { resolve } from "node:path";
import { runDirectSupervisor } from "./direct-supervisor";

const index = process.argv.indexOf("--config");
const configPath = process.argv[index + 1];
if (index === -1 || !configPath) {
	console.error("Usage: direct-supervisor.js --config <absolute config path>");
	process.exitCode = 1;
} else {
	void runDirectSupervisor(resolve(configPath)).catch((error) => {
		console.error("[direct-supervisor] failed", error);
		process.exitCode = 1;
	});
}
