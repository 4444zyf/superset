import { useEffect, useRef } from "react";
import { AgentIconView } from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentIcon/components/AgentIconView/AgentIconView";
import { AgentIconPickerView } from "renderer/routes/_authenticated/settings/agents/components/V2AgentsSettings/components/AgentIconPicker/components/AgentIconPickerView/AgentIconPickerView";
import { useWorkstationAppearance } from "../../../../providers/WorkstationPreferencesContext/WorkstationPreferencesContext";

type Selection = { canceled: boolean; dataUrl?: string };
export function WorkstationAgentIconPicker({
	value,
	onChange,
	disabled,
}: {
	value: string | null;
	onChange(v: string | null): void;
	disabled?: boolean;
}) {
	const { theme } = useWorkstationAppearance();
	const input = useRef<HTMLInputElement>(null),
		pending = useRef<{
			resolve(v: Selection): void;
			reject(e: Error): void;
		} | null>(null);
	useEffect(() => {
		const element = input.current;
		const cancel = () => {
			pending.current?.resolve({ canceled: true });
			pending.current = null;
		};
		element?.addEventListener("cancel", cancel);
		return () => {
			element?.removeEventListener("cancel", cancel);
			cancel();
		};
	}, []);
	return (
		<>
			<AgentIconPickerView
				menuModal
				value={value}
				onChange={onChange}
				disabled={disabled}
				renderIcon={(p) => (
					<AgentIconView {...p} isDark={theme.type === "dark"} />
				)}
				selectImage={() =>
					new Promise<Selection>((resolve, reject) => {
						if (pending.current || !input.current) {
							resolve({ canceled: true });
							return;
						}
						pending.current = { resolve, reject };
						input.current.click();
					})
				}
			/>
			<input
				ref={input}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				hidden
				onChange={async (e) => {
					const request = pending.current;
					if (!request) return;
					const file = e.currentTarget.files?.[0];
					e.currentTarget.value = "";
					try {
						if (!file) {
							request.resolve({ canceled: true });
							return;
						}
						if (
							file.size > 10 * 1024 * 1024 ||
							!["image/png", "image/jpeg", "image/webp"].includes(file.type)
						)
							throw new Error("Invalid agent icon source");
						const reader = new FileReader();
						const dataUrl = await new Promise<string>((done, fail) => {
							reader.onload = () => done(String(reader.result));
							reader.onerror = () => fail(reader.error);
							reader.readAsDataURL(file);
						});
						request.resolve({ canceled: false, dataUrl });
					} catch (e) {
						request.reject(
							e instanceof Error ? e : new Error("Failed to read agent icon"),
						);
					} finally {
						if (pending.current === request) pending.current = null;
					}
				}}
			/>
		</>
	);
}
