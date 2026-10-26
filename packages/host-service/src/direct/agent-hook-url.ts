let listener: { url: string } | null = null;

export function registerDirectAgentHookPort(
	port: number,
	hookToken: string,
): () => void {
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw Error("Invalid direct agent hook port");
	if (!/^[a-f0-9]{64}$/.test(hookToken))
		throw Error("Invalid direct agent hook capability");
	const current = { url: `http://127.0.0.1:${port}/agent-hook/${hookToken}` };
	listener = current;
	return () => {
		if (listener === current) listener = null;
	};
}

export function currentDirectAgentHookUrl(): string | null {
	return listener?.url ?? null;
}
