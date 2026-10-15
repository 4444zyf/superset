import { ProjectIconPicker } from "renderer/components/ProjectIconPicker";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

interface IconUploadFieldProps {
	projectId: string;
	projectName: string;
	hostUrl: string | null;
	iconUrl: string | null;
	hasCustomIcon: boolean;
	isIconRemoved: boolean;
	color: string | null;
}
export function IconUploadField({
	projectId,
	hostUrl,
	...props
}: IconUploadFieldProps) {
	return (
		<ProjectIconPicker
			{...props}
			disabled={!hostUrl}
			onSetIcon={async (icon) => {
				if (!hostUrl) return false;
				await getHostServiceClientByUrl(hostUrl).project.setIcon.mutate({
					projectId,
					icon,
				});
				return true;
			}}
			onSetColor={async (color) => {
				if (!hostUrl) return false;
				await getHostServiceClientByUrl(hostUrl).project.setColor.mutate({
					projectId,
					color,
				});
				return true;
			}}
		/>
	);
}
