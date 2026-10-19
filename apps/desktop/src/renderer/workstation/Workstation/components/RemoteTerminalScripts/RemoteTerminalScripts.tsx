import { RemoteTerminalScriptsView } from "./components/RemoteTerminalScriptsView/RemoteTerminalScriptsView";
import type { RemoteTerminalScriptsProps } from "./remote-terminal-scripts-types";
export function RemoteTerminalScripts(props: RemoteTerminalScriptsProps) {
	const owner = JSON.stringify([
		props.connection.connectionId,
		props.connection.backendId,
		props.connection.namespaceId,
		props.connection.generation,
		props.workspaceId,
	]);
	return props.connection.capabilities?.workstationTerminalScriptsV1 ===
		true ? (
		<RemoteTerminalScriptsView key={owner} {...props} />
	) : null;
}
