import type { SimpleGit } from "simple-git";

/**
 * Check if the error message indicates the upstream branch is missing/deleted
 */
export function isUpstreamMissingError(message: string): boolean {
	return (
		message.includes("no such ref was fetched") ||
		message.includes("no tracking information") ||
		message.includes("couldn't find remote ref") ||
		message.includes("cannot be resolved to branch")
	);
}

/**
 * Check if the error message indicates a rebase/merge conflict — an expected
 * outcome of pulling into a branch with divergent local commits
 */
export function isMergeConflictError(message: string): boolean {
	return (
		message.includes("CONFLICT (") ||
		message.includes("Merge conflict in") ||
		message.includes("could not apply") ||
		message.includes("Resolve all conflicts manually")
	);
}

export async function fetchTrackingBranch(
	git: SimpleGit,
	remote: string,
	branch: string | null | undefined,
): Promise<void> {
	if (!branch) {
		return;
	}

	try {
		await git.fetch([remote, branch]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isUpstreamMissingError(message)) {
			try {
				await git.fetch([remote]);
			} catch (fallbackError) {
				const fallbackMessage =
					fallbackError instanceof Error
						? fallbackError.message
						: String(fallbackError);
				if (!isUpstreamMissingError(fallbackMessage)) {
					console.error(
						`[git/fetch] failed fallback fetch for branch ${branch}:`,
						fallbackError,
					);
					throw fallbackError;
				}
			}
			return;
		}
		throw error;
	}
}
