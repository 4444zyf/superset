import { randomUUID } from "node:crypto";
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
	const delimiter = `SUPERSET_DIRECT_BOOTSTRAP_${randomUUID()}`;
	// sudo can consume the password or leave it unread (cached/NOPASSWD).
	// The root shell skips that optional line, then executes the streamed script.
	const reader = `while IFS= read -r superset_direct_line; do
  [ "$superset_direct_line" != '${delimiter}' ] || exec /bin/sh -s
done
exit 65`;
	return transport.exec(
		`/usr/bin/sudo -S -p '' /bin/sh -c ${quote(reader)}`,
		`${password}\n${delimiter}\n${script}`,
	);
}
