import { ExistingSessionOption } from "../ExistingSessionOption";
import { NewSessionOption } from "../NewSessionOption";
import {
	AgentSessionSelectView,
	type AgentSessionSelectViewProps,
} from "./components/AgentSessionSelectView";

type AgentSessionSelectProps = Omit<
	AgentSessionSelectViewProps,
	"renderExisting" | "renderNew"
>;
export function AgentSessionSelect(props: AgentSessionSelectProps) {
	return (
		<AgentSessionSelectView
			{...props}
			renderExisting={(option) => <ExistingSessionOption {...option} />}
			renderNew={(option) => <NewSessionOption {...option} />}
		/>
	);
}
