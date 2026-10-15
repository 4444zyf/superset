export {
	isMergeConflictError,
	isUpstreamMissingError,
} from "@superset/host-service/git";

export function isNoPullRequestFoundMessage(message: string): boolean {
	return message.toLowerCase().includes("no pull request");
}
