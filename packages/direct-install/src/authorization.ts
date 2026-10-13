import type { RemoteCommandResult, RemoteTransport } from "./install";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Keep the potentially large bootstrap out of sudo/SSH arguments. */
export async function authorizeRemoteScript(
	transport: RemoteTransport,
	script: string,
	password: string,
): Promise<RemoteCommandResult> {
	if (/[\r\n\0]/.test(password))
		throw new Error("Invalid administrator password input");
	let delimiter = "SUPERSET_DIRECT_BOOTSTRAP";
	while (script.split("\n").includes(delimiter)) delimiter += "_";
	return transport.exec(
		"/bin/sh -s",
		`set -eu
umask 077
work=$(/usr/bin/mktemp -d /private/tmp/superset-direct-auth.XXXXXXXX)
trap '/bin/rm -rf "$work"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
/bin/cat > "$work/bootstrap.sh" <<'${delimiter}'
${script}
${delimiter}
printf '%s\\n' ${quote(password)} | /usr/bin/sudo -S -p '' /bin/sh "$work/bootstrap.sh"
`,
	);
}
