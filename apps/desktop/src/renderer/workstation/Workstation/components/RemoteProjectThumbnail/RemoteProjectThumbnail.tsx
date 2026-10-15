import { useLingui } from "@lingui/react/macro";
import { resolveProjectIconUrl } from "renderer/hooks/host-projects/resolveProjectIconUrl";
import { ProjectThumbnail } from "renderer/routes/_authenticated/components/ProjectThumbnail";
import type { RemoteProject } from "../../types";

export function RemoteProjectThumbnail({
	project,
	className,
}: {
	project?: RemoteProject;
	className?: string;
}) {
	const { t } = useLingui();
	return (
		<ProjectThumbnail
			projectName={project?.name ?? t({ message: "Session" })}
			iconUrl={resolveProjectIconUrl({
				icon: project?.icon ?? null,
				repoOwner: project?.repoOwner ?? null,
			})}
			color={project?.color}
			className={className}
		/>
	);
}
