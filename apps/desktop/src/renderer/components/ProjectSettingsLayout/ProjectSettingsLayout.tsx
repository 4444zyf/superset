import type { ReactNode } from "react";
import { ProjectThumbnail } from "renderer/routes/_authenticated/components/ProjectThumbnail";

export function ProjectSettingsLayout({
	projectName,
	iconUrl,
	color,
	hostPicker,
	children,
}: {
	projectName: string;
	iconUrl: string | null;
	color: string | null;
	hostPicker?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="p-6 max-w-4xl w-full min-w-0 mx-auto select-text">
			<header className="mb-8 flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3">
					<ProjectThumbnail
						projectName={projectName}
						iconUrl={iconUrl}
						color={color}
					/>
					<h2 className="truncate text-xl font-semibold">{projectName}</h2>
				</div>
				{hostPicker}
			</header>
			<div className="space-y-10">{children}</div>
		</div>
	);
}
