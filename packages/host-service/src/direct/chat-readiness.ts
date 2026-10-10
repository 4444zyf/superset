import { findOnPath } from "../chat-v3/agentCli";
import { getTerminalBaseEnv } from "../terminal/env";
import { directAgentPath, directAgentProfiles } from "./agent-environment";

export function directChatHarnesses(environment?: NodeJS.ProcessEnv) {
	let env = environment;
	if (!env) {
		try {
			env = getTerminalBaseEnv();
		} catch {
			env = process.env;
		}
	}
	const profiles = directAgentProfiles();
	return (
		[
			{ id: "claude-code", binary: "claude" },
			{ id: "codex", binary: "codex" },
		] as const
	).map(({ id, binary }) => {
		const available = findOnPath(binary, directAgentPath(env)) !== null;
		const configDir =
			binary === "claude" ? profiles?.claudeConfigDir : profiles?.codexHome;
		return {
			id,
			available,
			authenticationChecked: false,
			configDir,
			reason: available
				? `CLI found on the remote machine; sign-in and version are checked when a chat starts${configDir ? `. Sign in on B using ${binary === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"}=${configDir}` : ""}`
				: `Install ${binary} on the remote machine and add it to the service user's login-shell PATH`,
		};
	});
}
