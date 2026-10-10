import { Trans } from "@lingui/react/macro";
import { useState } from "react";

interface ProjectInput {
	operationId: string;
	name: string;
	mode:
		| { kind: "clone"; parentDir: string; url: string }
		| { kind: "empty"; parentDir: string };
}

export function RemoteProjectCreator({
	parentDir,
	busy,
	disabled = false,
	onCreate,
}: {
	parentDir: string;
	busy: boolean;
	disabled?: boolean;
	onCreate(input: ProjectInput): Promise<void>;
}) {
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const field =
		"rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm min-w-0";
	const button =
		"rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-40";
	const create = (kind: "clone" | "empty") =>
		onCreate({
			operationId: crypto.randomUUID(),
			name: name.trim(),
			mode:
				kind === "clone"
					? { kind, parentDir, url: url.trim() }
					: { kind, parentDir },
		});
	return (
		<div className="grid gap-2 border-t border-zinc-700 pt-3">
			<label className="grid gap-1">
				<Trans>Project name</Trans>
				<input
					className={field}
					value={name}
					onChange={(event) => setName(event.target.value)}
					maxLength={200}
				/>
			</label>
			<label className="grid gap-1">
				<Trans>Repository URL or path</Trans>
				<input
					className={field}
					value={url}
					onChange={(event) => setUrl(event.target.value)}
				/>
			</label>
			<div className="flex gap-2">
				<button
					className={button}
					type="button"
					disabled={busy || disabled || !name.trim() || !url.trim()}
					onClick={() => void create("clone")}
				>
					<Trans>Clone</Trans>
				</button>
				<button
					className={button}
					type="button"
					disabled={busy || disabled || !name.trim()}
					onClick={() => void create("empty")}
				>
					<Trans>Create project</Trans>
				</button>
			</div>
		</div>
	);
}
