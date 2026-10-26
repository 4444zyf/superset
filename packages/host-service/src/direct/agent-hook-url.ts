let listener: { url: string } | null = null;

export function registerDirectAgentHookPort(port: number): () => void {
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw Error("Invalid direct agent hook port");
	const current = { url: `http://127.0.0.1:${port}/trpc/notifications.hook` };
	listener = current;
	return () => {
		if (listener === current) listener = null;
	};
}

export function currentDirectAgentHookUrl(): string | null {
	return listener?.url ?? null;
}
