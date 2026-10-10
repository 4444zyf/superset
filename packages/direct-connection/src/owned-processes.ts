interface OwnedChild {
	kill(): boolean;
	once(event: "close" | "error", listener: () => void): unknown;
}

export class OwnedSshProcesses {
	private readonly children = new Map<OwnedChild, string>();
	private readonly versions = new Map<string, number>();
	private closed = false;
	version(connectionId: string): number {
		return this.versions.get(connectionId) ?? 0;
	}
	track(
		connectionId: string,
		child: OwnedChild,
		version = this.version(connectionId),
	): void {
		if (this.closed || version !== this.version(connectionId)) {
			child.kill();
			return;
		}
		this.children.set(child, connectionId);
		const forget = () => this.children.delete(child);
		child.once("close", forget);
		child.once("error", forget);
	}
	cancel(connectionId: string): void {
		this.versions.set(connectionId, this.version(connectionId) + 1);
		for (const [child, owner] of this.children) {
			if (owner !== connectionId) continue;
			this.children.delete(child);
			child.kill();
		}
	}
	dispose(): void {
		this.closed = true;
		for (const owner of new Set(this.children.values())) this.cancel(owner);
	}
}
