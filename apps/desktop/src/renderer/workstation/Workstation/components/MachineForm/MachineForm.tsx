import { Trans, useLingui } from "@lingui/react/macro";
import { Check, Link2, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import type {
	DirectProfile,
	DirectWorkstationApi,
	MachineProbe,
} from "../../types";
import { WorkstationDialog } from "../WorkstationDialog/WorkstationDialog";

export function MachineForm({
	profile,
	api,
	onSave,
	onClose,
	serverError,
}: {
	profile?: DirectProfile;
	api: DirectWorkstationApi;
	onSave(profile: DirectProfile): Promise<boolean>;
	onClose(): void;
	serverError?: string | null;
}) {
	const { t } = useLingui();
	const id = useRef(profile?.id ?? crypto.randomUUID());
	const revision = useRef(0);
	const [mode, setMode] = useState<"host" | "alias">("host");
	const [testing, setTesting] = useState(false);
	const [saving, setSaving] = useState(false);
	const [probe, setProbe] = useState<MachineProbe | null>(null);
	const [error, setError] = useState<string | null>(null);
	const form = useRef<HTMLFormElement>(null);
	const read = (): DirectProfile => {
		if (!form.current) throw new Error("Connection form is closed");
		const data = new FormData(form.current);
		return {
			id: id.current,
			name: String(data.get("name")).trim(),
			host: String(data.get("host")).trim(),
			...(mode === "host" && data.get("user")
				? { user: String(data.get("user")).trim() }
				: {}),
			...(mode === "host" && data.get("port")
				? { port: Number(data.get("port")) }
				: {}),
			...(mode === "host" && data.get("identity")
				? { identityFile: String(data.get("identity")).trim() }
				: {}),
		};
	};
	const test = async () => {
		if (!form.current?.reportValidity() || !api.testProfile) return;
		const current = ++revision.current;
		setTesting(true);
		setProbe(null);
		setError(null);
		try {
			const result = await api.testProfile(read());
			if (current === revision.current) setProbe(result);
		} catch (error) {
			if (current === revision.current)
				setError(error instanceof Error ? error.message : String(error));
		} finally {
			if (current === revision.current) setTesting(false);
		}
	};
	return (
		<WorkstationDialog
			drawer
			error={serverError}
			title={
				profile
					? t({ message: "Edit connection" })
					: t({ message: "Add machine" })
			}
			onClose={() => {
				revision.current++;
				onClose();
			}}
		>
			<form
				ref={form}
				className="ws-drawer-form"
				onInput={() => {
					revision.current++;
					setProbe(null);
					setError(null);
					setTesting(false);
				}}
				onSubmit={async (event) => {
					event.preventDefault();
					if (saving || testing) return;
					setSaving(true);
					try {
						if (await onSave(read())) onClose();
					} finally {
						setSaving(false);
					}
				}}
			>
				<div className="ws-dialog-body">
					<p className="ws-description">
						<Trans>
							Connect directly to your machine. Agents keep running when this
							app closes.
						</Trans>
					</p>
					<label className="ws-field">
						<Trans>Name</Trans>
						<input
							name="name"
							required
							maxLength={100}
							defaultValue={profile?.name}
						/>
					</label>
					<div className="ws-segmented">
						<button
							type="button"
							className={mode === "host" ? "active" : ""}
							onClick={() => {
								revision.current++;
								setMode("host");
								setProbe(null);
								setTesting(false);
							}}
						>
							<Trans>SSH host</Trans>
						</button>
						<button
							type="button"
							className={mode === "alias" ? "active" : ""}
							onClick={() => {
								revision.current++;
								setMode("alias");
								setProbe(null);
								setTesting(false);
							}}
						>
							<Trans>SSH config alias</Trans>
						</button>
					</div>
					<label className="ws-field">
						<Trans>SSH host</Trans>
						<input
							name="host"
							required
							maxLength={255}
							defaultValue={profile?.host}
							placeholder={mode === "alias" ? "mini-studio" : "mac-mini.local"}
						/>
					</label>
					{mode === "host" && (
						<>
							<div className="ws-field-row">
								<label className="ws-field">
									<Trans>SSH user</Trans>
									<input
										name="user"
										autoComplete="off"
										defaultValue={profile?.user}
									/>
								</label>
								<label className="ws-field">
									<Trans>Port</Trans>
									<input
										name="port"
										type="number"
										min={1}
										max={65535}
										defaultValue={profile?.port}
										placeholder="22"
									/>
								</label>
							</div>
							<label className="ws-field">
								<Trans>Identity file</Trans>
								<input
									name="identity"
									defaultValue={profile?.identityFile}
									placeholder="~/.ssh/id_ed25519"
								/>
							</label>
						</>
					)}
					<div className="ws-info">
						<ShieldCheck size={17} />
						<p>
							<Trans>
								Before the first SSH connection, run SSH in your system terminal
								and verify the host fingerprint.
							</Trans>
						</p>
					</div>
					<button
						type="button"
						className="ws-button"
						disabled={
							testing || saving || !api.testProfile || api.platform === "win32"
						}
						onClick={() => void test()}
					>
						<Link2 size={15} />
						{testing ? (
							<Trans>Connecting</Trans>
						) : (
							<Trans>Test connection</Trans>
						)}
					</button>
					{probe && (
						<output className="ws-probe">
							<Check size={15} />
							<div>
								<Trans>SSH connection successful</Trans>
								<p>
									{probe.platform} · {probe.architecture}
								</p>
								<p>
									{probe.installed ? (
										<Trans>Backend found</Trans>
									) : (
										<Trans>Install</Trans>
									)}
								</p>
							</div>
						</output>
					)}
					{error && (
						<p className="ws-error" role="alert">
							{error}
						</p>
					)}
					<p className="ws-description">
						<Trans>Connection settings are stored on this device.</Trans>
					</p>
				</div>
				<div className="ws-dialog-footer">
					<button
						type="button"
						className="ws-button"
						disabled={saving}
						onClick={() => {
							revision.current++;
							onClose();
						}}
					>
						<Trans>Cancel</Trans>
					</button>
					<button
						type="submit"
						className="ws-button primary"
						disabled={testing || saving}
					>
						{profile ? <Trans>Save</Trans> : <Trans>Add connection</Trans>}
					</button>
				</div>
			</form>
		</WorkstationDialog>
	);
}
