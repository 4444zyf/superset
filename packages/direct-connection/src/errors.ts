export class DirectConnectionError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "DirectConnectionError";
	}
}

export function sshFailure(stderr: string): DirectConnectionError {
	const authentication =
		/Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|Too many authentication failures|Bad owner or permissions|No authentication methods/i.test(
			stderr,
		);
	const transport =
		!authentication &&
		/Connection timed out|Connection refused|No route to host|Network is unreachable|Connection reset|Connection closed|Could not resolve hostname|kex_exchange_identification:.*(?:closed|reset)/i.test(
			stderr,
		);
	return new DirectConnectionError(
		transport
			? "SSH connection unavailable; check the network and remote machine"
			: "SSH authentication failed; verify the host key and unlock your key in the system SSH agent",
		transport,
	);
}
