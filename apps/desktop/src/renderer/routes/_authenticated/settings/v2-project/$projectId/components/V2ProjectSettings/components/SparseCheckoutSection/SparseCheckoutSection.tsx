import { useMutation } from "@tanstack/react-query";
import { SparseCheckoutField } from "renderer/components/SparseCheckoutField";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

interface SparseCheckoutSectionProps {
	projectId: string;
	hostUrl: string;
	paths: string[];
	onChanged(): void;
}
export function SparseCheckoutSection({
	projectId,
	hostUrl,
	paths,
	onChanged,
}: SparseCheckoutSectionProps) {
	const mutation = useMutation({
		mutationFn: (next: string[]) =>
			getHostServiceClientByUrl(hostUrl).project.setSparseCheckoutPaths.mutate({
				projectId,
				paths: next,
			}),
	});
	return (
		<SparseCheckoutField
			paths={paths}
			onSave={mutation.mutateAsync}
			onChanged={onChanged}
		/>
	);
}
