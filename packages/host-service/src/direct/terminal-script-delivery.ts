import { TRPCError } from "@trpc/server";
export interface ExistingTerminalScriptInput {
	workspaceId: string;
	terminalId: string;
	executionId: string;
	text: string;
}
export interface TerminalScriptDelivery {
	inspect(): Promise<{ state: string; executionId?: string }>;
	connect(): Promise<{
		list(): Promise<{ id: string; executionId?: string; alive: boolean }[]>;
		inputExisting(id: string, executionId: string, data: Buffer): void;
		dispose(): Promise<void>;
	}>;
	frame(
		write: (data: string) => void,
	): Promise<{ success: true } | { error: string }>;
}
export async function deliverExistingTerminalScript(
	input: ExistingTerminalScriptInput,
	delivery: TerminalScriptDelivery,
) {
	const { terminalId, executionId } = input;
	const resource = await delivery.inspect();
	if (resource.state !== "live" || resource.executionId !== executionId)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "The terminal execution is no longer current",
		});
	const daemon = await delivery.connect();
	const check = async () => {
		const current = (await daemon.list()).find((row) => row.id === terminalId);
		if (!current?.alive || current.executionId !== executionId)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "The terminal execution is no longer current",
			});
	};
	try {
		await check();
		const result = await delivery.frame((data) =>
			daemon.inputExisting(terminalId, executionId, Buffer.from(data)),
		);
		if ("error" in result)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: result.error,
			});
		await check();
		return { terminalId, executionId, submitted: true as const };
	} finally {
		await daemon.dispose();
	}
}
