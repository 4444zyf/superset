import { useMutation } from "@tanstack/react-query";
import { NamingInstructionsField } from "renderer/components/NamingInstructionsField";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

interface NamingInstructionsSectionProps {
	projectId: string;
	hostUrl: string;
	instructions: string | null;
	onChanged(): void;
}
export function NamingInstructionsSection({
	projectId,
	hostUrl,
	instructions,
	onChanged,
}: NamingInstructionsSectionProps) {
	const mutation = useMutation({
		mutationFn: (next: string) =>
			getHostServiceClientByUrl(hostUrl).project.setNamingInstructions.mutate({
				projectId,
				instructions: next.trim() || null,
			}),
	});
	return (
		<NamingInstructionsField
			instructions={instructions}
			onSave={mutation.mutateAsync}
			onChanged={onChanged}
		/>
	);
}
