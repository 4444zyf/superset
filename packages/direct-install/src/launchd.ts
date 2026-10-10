import { join } from "node:path";

export interface LaunchDaemonOptions {
	uid: number;
	username: string;
	groupname: string;
	userHome: string;
	releaseRoot: string;
	configPath: string;
}
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

export function createLaunchDaemonPlist(options: LaunchDaemonOptions): string {
	if (!Number.isSafeInteger(options.uid) || options.uid <= 0)
		throw new Error("The backend cannot run as root");
	if (
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(options.username) ||
		!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(options.groupname) ||
		!options.userHome.startsWith("/") ||
		!options.configPath.startsWith(`${options.userHome}/.superset-direct/`) ||
		!options.releaseRoot.startsWith(
			"/Library/Application Support/SupersetDirect/runtime/",
		)
	)
		throw new Error("Invalid launchd service identity or paths");
	const home = join(options.userHome, ".superset-direct");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.superset.direct.backend.${options.uid}</string>
<key>ProgramArguments</key><array><string>${xml(join(options.releaseRoot, "lib/node"))}</string><string>${xml(join(options.releaseRoot, "lib/direct-supervisor.js"))}</string><string>--config</string><string>${xml(options.configPath)}</string></array>
<key>UserName</key><string>${xml(options.username)}</string><key>GroupName</key><string>${xml(options.groupname)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>AbandonProcessGroup</key><true/>
<key>WorkingDirectory</key><string>${xml(options.userHome)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(options.userHome)}</string><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>${xml(join(home, "logs/service.log"))}</string><key>StandardErrorPath</key><string>${xml(join(home, "logs/service-error.log"))}</string>
</dict></plist>\n`;
}
