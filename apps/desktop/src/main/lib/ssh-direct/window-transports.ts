interface WindowTransports {
	sockets: { closeOwner(ownerId: number): void };
	forwards: { closeConnection(connectionId: string): void; dispose(): void };
}

export function closeWindowTransports(
	ownerId: number,
	connectionIds: string[],
	transports: WindowTransports,
): void {
	transports.sockets.closeOwner(ownerId);
	for (const connectionId of connectionIds)
		transports.forwards.closeConnection(connectionId);
}
