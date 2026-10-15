import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProjectScriptsEditor } from "renderer/components/ProjectScriptsEditor";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

export function V2ScriptsEditor({
	hostUrl,
	projectId,
	className,
}: {
	hostUrl: string;
	projectId: string;
	className?: string;
}) {
	const queryClient = useQueryClient();
	const queryKey = ["host-config", "getConfigContent", hostUrl, projectId];
	const { data, isLoading } = useQuery({
		queryKey,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).config.getConfigContent.query({
				projectId,
			}),
	});
	const mutation = useMutation({
		mutationFn: (input: {
			setup: string[];
			teardown: string[];
			run: string[];
		}) =>
			getHostServiceClientByUrl(hostUrl).config.updateConfig.mutate({
				projectId,
				...input,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey });
		},
	});
	return (
		<ProjectScriptsEditor
			key={`${hostUrl}:${projectId}`}
			content={data?.content ?? null}
			isLoading={isLoading}
			className={className}
			onSave={(value) => mutation.mutateAsync(value)}
		/>
	);
}
