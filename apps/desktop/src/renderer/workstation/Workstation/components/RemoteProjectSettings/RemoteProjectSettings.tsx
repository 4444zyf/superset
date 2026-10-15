import { Trans, useLingui } from "@lingui/react/macro";
import type { AppRouter } from "@superset/host-service";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Textarea } from "@superset/ui/textarea";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { ColorSelector } from "renderer/components/ColorSelector";
import { BranchPrefixControl } from "renderer/routes/_authenticated/settings/components/BranchPrefixControl/BranchPrefixControl";
import { SettingsRow } from "renderer/routes/_authenticated/settings/components/SettingsRow";
import { SettingsSection } from "renderer/routes/_authenticated/settings/components/SettingsSection";
import { ProjectSettingsLayout } from "renderer/routes/_authenticated/settings/v2-project/$projectId/components/V2ProjectSettings/components/V2ProjectSettingsBody/components/ProjectSettingsLayout/ProjectSettingsLayout";
import { PROJECT_COLOR_DEFAULT } from "shared/constants/project-colors";
import type {
	DirectDescriptor,
	DirectWorkstationApi,
} from "../../../../../shared/direct-workstation";
import { WorkstationDialog } from "../WorkstationDialog/WorkstationDialog";

type Project = NonNullable<inferRouterOutputs<AppRouter>["project"]["get"]>;
type Draft = Project & { namingText: string; sparseText: string };
const toDraft = (project: Project): Draft => ({
	...project,
	namingText: project.namingInstructions ?? "",
	sparseText: project.sparseCheckoutPaths.join("\n"),
});

export function RemoteProjectSettings({
	api,
	connection,
	projectId,
	onClose,
	onChanged,
}: {
	api: DirectWorkstationApi;
	connection: DirectDescriptor;
	projectId: string;
	onClose(): void;
	onChanged(): void;
}) {
	const { t } = useLingui();
	const owner = JSON.stringify([
		connection.connectionId,
		connection.backendId,
		connection.namespaceId,
		connection.generation,
		projectId,
		connection.capabilities?.workstationProjectsV1 === true,
	]);
	const ownerRef = useRef(owner);
	ownerRef.current = owner;
	const mountedOwner = useRef<string | null>(null);
	const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
	const [project, setProject] = useState<Project | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const running = useRef(false);
	const blocked = useRef(false);
	const skipNameBlur = useRef(false);
	const capable = connection.capabilities?.workstationProjectsV1 === true;
	const read = async () => {
		const actual = await api.rpc<Project | null>({
			connectionId: connection.connectionId,
			generation: connection.generation,
			path: "project.get",
			type: "query",
			input: { projectId },
		});
		if (!actual || actual.id !== projectId)
			throw new Error(t({ message: "Project not found." }));
		return actual;
	};
	const install = (actual: Project) => {
		setProject(actual);
		setDraft(toDraft(actual));
		setLoadedOwner(owner);
	};
	const owned = () =>
		ownerRef.current === owner && mountedOwner.current === owner;
	useEffect(() => {
		mountedOwner.current = owner;
		let cancelled = false;
		running.current = false;
		blocked.current = false;
		setProject(null);
		setDraft(null);
		setError(null);
		setBusy(true);
		if (!capable) {
			setBusy(false);
			return;
		}
		void read()
			.then((actual) => {
				if (!actual && !cancelled && owned())
					setError(t({ message: "Project not found." }));
				if (!cancelled && ownerRef.current === owner && actual) install(actual);
			})
			.catch((err) => {
				if (!cancelled && ownerRef.current === owner)
					setError(errorMessage(err));
			})
			.finally(() => {
				if (!cancelled && ownerRef.current === owner) setBusy(false);
			});
		return () => {
			cancelled = true;
			if (mountedOwner.current === owner) mountedOwner.current = null;
		};
	}, [api, owner, capable]);
	const change = (patch: Partial<Draft>) => {
		if (!running.current && !blocked.current)
			setDraft((value) => value && { ...value, ...patch });
	};
	const save = async (
		path: string,
		input: Record<string, unknown>,
		confirms: (actual: Project) => boolean,
	) => {
		if (running.current || blocked.current || !capable || !project || !owned())
			return;
		running.current = true;
		setBusy(true);
		setError(null);
		try {
			await api.rpc({
				connectionId: connection.connectionId,
				generation: connection.generation,
				path,
				type: "mutation",
				input: { projectId, ...input },
			});
			if (!owned()) return;
			const actual = await read();
			if (!owned()) return;
			if (!actual) throw new Error(t({ message: "Project not found." }));
			install(actual);
			onChanged();
		} catch (err) {
			if (!owned()) return;
			let actual: Project | null = null;
			try {
				actual = await read();
			} catch {}
			if (!owned()) return;
			if (actual && confirms(actual)) {
				install(actual);
				onChanged();
			} else {
				blocked.current = true;
				setError(errorMessage(err));
			}
		} finally {
			if (owned()) {
				running.current = false;
				setBusy(false);
			}
		}
	};
	const refresh = async () => {
		if (running.current || !capable) return;
		running.current = true;
		setBusy(true);
		try {
			const actual = await read();
			if (!owned()) return;
			if (actual) {
				install(actual);
				blocked.current = false;
				setError(null);
			}
		} catch (err) {
			if (owned()) setError(errorMessage(err));
		} finally {
			if (owned()) {
				running.current = false;
				setBusy(false);
			}
		}
	};
	return (
		<WorkstationDialog
			className="ws-project-settings"
			title={t({ message: "Project Settings" })}
			drawer
			onClose={onClose}
			error={error}
		>
			<div
				className="ws-dialog-body min-w-0 min-h-0 flex-1 overflow-auto"
				data-project-settings={projectId}
			>
				<Button
					type="button"
					variant="outline"
					disabled={busy || !capable}
					onClick={() => void refresh()}
				>
					<Trans>Refresh</Trans>
				</Button>
				{loadedOwner === owner && project && draft && (
					<fieldset disabled={busy || blocked.current}>
						<ProjectSettingsLayout
							projectName={project.name}
							iconUrl={
								project.icon?.startsWith("data:image/") ? project.icon : null
							}
							color={project.color}
						>
							<SettingsSection title={t({ message: "General" })}>
								<SettingsRow
									label={t({ message: "Name" })}
									htmlFor="project-name"
								>
									<Input
										id="project-name"
										value={draft.name}
										maxLength={200}
										className="w-64 max-w-full"
										onChange={(e) => change({ name: e.target.value })}
										onBlur={() => {
											if (skipNameBlur.current) {
												skipNameBlur.current = false;
												return;
											}
											const name = draft.name.trim();
											if (!name) {
												change({ name: project.name });
												return;
											}
											if (name && name !== project.name)
												void save(
													"project.update",
													{ name },
													(actual) => actual.name === name,
												);
										}}
										onKeyDown={(e) => {
											if (e.nativeEvent.isComposing) return;
											if (e.key === "Enter") {
												e.preventDefault();
												e.currentTarget.blur();
											}
											if (e.key === "Escape") {
												e.preventDefault();
												e.stopPropagation();
												skipNameBlur.current = true;
												change({ name: project.name });
												e.currentTarget.blur();
											}
										}}
									/>
								</SettingsRow>
								<SettingsRow
									label={t({ message: "Repository" })}
									htmlFor="project-repo"
								>
									<Input
										id="project-repo"
										readOnly
										disabled
										value={project.repoUrl ?? ""}
										placeholder={t({ message: "No git remote detected" })}
										className="w-64 max-w-full font-mono text-xs"
									/>
								</SettingsRow>
								<SettingsRow label={t({ message: "Color" })}>
									<ColorSelector
										includeDefault
										selectedColor={draft.color}
										className="max-w-64"
										disabled={busy || blocked.current}
										onSelectColor={(color) => {
											const value =
												color === PROJECT_COLOR_DEFAULT ? null : color;
											change({ color: value });
											if (value !== project.color)
												void save(
													"project.setColor",
													{ color: value },
													(actual) => actual.color === value,
												);
										}}
									/>
								</SettingsRow>
							</SettingsSection>
							<SettingsSection
								title={t({ message: "Branches & naming" })}
								description={t({
									message:
										"How branches and workspace names are created for this project.",
								})}
							>
								<SettingsRow
									label={t({ message: "Branch prefix" })}
									hint={t({
										message:
											"Namespace new branches for this project. Defaults to the host-wide Git setting.",
									})}
								>
									<BranchPrefixControl
										showDefault
										mode={draft.branchPrefixMode}
										customPrefix={draft.branchPrefixCustom}
										disabled={busy || blocked.current}
										onChange={({ mode, customPrefix }) => {
											change({
												branchPrefixMode: mode,
												branchPrefixCustom: customPrefix,
											});
											if (
												mode !== project.branchPrefixMode ||
												customPrefix !== project.branchPrefixCustom
											)
												void save(
													"project.setBranchPrefix",
													{ mode, customPrefix },
													(actual) =>
														actual.branchPrefixMode === mode &&
														actual.branchPrefixCustom === customPrefix,
												);
										}}
									/>
								</SettingsRow>
								<div className="pt-4">
									<Label htmlFor="project-naming-instructions">
										<Trans>Naming instructions</Trans>
									</Label>
									<p className="text-xs text-muted-foreground mt-0.5 mb-3">
										<Trans>
											Guides AI-generated workspace and branch names for this
											project. Empty uses the default naming.
										</Trans>
									</p>
									<Textarea
										id="project-naming-instructions"
										rows={3}
										maxLength={2000}
										value={draft.namingText}
										onChange={(e) => change({ namingText: e.target.value })}
										onBlur={() => {
											const instructions = draft.namingText.trim() || null;
											if (instructions !== project.namingInstructions)
												void save(
													"project.setNamingInstructions",
													{ instructions },
													(actual) =>
														actual.namingInstructions === instructions,
												);
										}}
									/>
								</div>
							</SettingsSection>
							<SettingsSection
								title={t({ message: "Location & checkout" })}
								description={t({
									message:
										"Where the repository and new worktrees live on this host.",
								})}
							>
								<SettingsRow label={t({ message: "Location" })}>
									<code className="block max-w-64 break-all text-xs">
										{project.repoPath}
									</code>
								</SettingsRow>
								<SettingsRow
									label={t({ message: "Worktrees" })}
									hint={t({
										message:
											"Base directory for new worktree workspaces on this host.",
									})}
								>
									<code className="text-xs">~/Superset Remix/worktrees/</code>
								</SettingsRow>
								<div className="pt-4">
									<Label htmlFor="project-sparse-checkout">
										<Trans>Sparse checkout</Trans>
									</Label>
									<p className="mt-0.5 mb-3 text-xs text-muted-foreground">
										<Trans>
											Folders to check out into new worktrees, one per line,
											relative to the repo root. Files at the root are always
											included. Empty checks out everything.
										</Trans>
									</p>
									<Textarea
										id="project-sparse-checkout"
										rows={3}
										spellCheck={false}
										maxLength={128 * 1024}
										className="font-mono text-sm resize-y min-h-[calc(3lh+1.125rem)]"
										value={draft.sparseText}
										onChange={(e) => change({ sparseText: e.target.value })}
										onBlur={() => {
											const paths = draft.sparseText
												.split(/\r?\n/)
												.map((p) => p.trim())
												.filter(Boolean);
											if (
												JSON.stringify(paths) !==
												JSON.stringify(project.sparseCheckoutPaths)
											)
												void save(
													"project.setSparseCheckoutPaths",
													{ paths },
													(actual) =>
														JSON.stringify(actual.sparseCheckoutPaths) ===
														JSON.stringify(paths),
												);
										}}
									/>
								</div>
							</SettingsSection>
						</ProjectSettingsLayout>
					</fieldset>
				)}
			</div>
		</WorkstationDialog>
	);
}
