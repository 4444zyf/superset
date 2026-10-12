export function directPublisher(repository = "4444zyf/superset"): {
	provider: "github";
	owner: string;
	repo: string;
} {
	if (
		repository !== repository.trim() ||
		!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(
			repository,
		) ||
		repository.split("/")[1] === "." ||
		repository.split("/")[1] === ".."
	)
		throw new Error("GITHUB_REPOSITORY must be a valid owner/repository pair");
	const [owner, repo] = repository.split("/") as [string, string];
	return { provider: "github", owner, repo };
}
