export interface DirectSupervisorOptions {
	signal: AbortSignal;
	isDisabled: () => boolean;
	beforeStart?: () => Promise<void>;
	spawnBackend: () => Promise<{
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	}>;
	waitForRetry: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export async function monitorDirectChild<T>(
	child: { exited: Promise<T>; terminate: () => void },
	finalize: (options: { stopCurrent: () => Promise<void> }) => Promise<void>,
	options: {
		waitForTick?: (signal: AbortSignal) => Promise<void>;
		onFault?: (error: unknown) => void;
	} = {},
): Promise<T> {
	let stopped = false;
	const controller = new AbortController();
	const exited = child.exited.then(
		(value) => {
			controller.abort();
			return { ok: true as const, value };
		},
		(error: unknown) => {
			controller.abort();
			return { ok: false as const, error };
		},
	);
	const stopCurrent = async () => {
		if (!stopped && !controller.signal.aborted) {
			stopped = true;
			child.terminate();
		}
		await exited;
	};
	while (!controller.signal.aborted) {
		try {
			await finalize({ stopCurrent });
		} catch (error) {
			(
				options.onFault ??
				((fault) =>
					console.error(
						"[direct-supervisor] activation recovery failed",
						fault,
					))
			)(error);
		}
		if (controller.signal.aborted) break;
		await (
			options.waitForTick ??
			(async (signal) => {
				await wait(250, undefined, { signal }).catch((error) => {
					if (!signal.aborted) throw error;
				});
			})
		)(controller.signal);
	}
	const result = await exited;
	if (!result.ok) throw result.error;
	return result.value;
}

export async function superviseDirectBackend(
	options: DirectSupervisorOptions,
): Promise<void> {
	let attempts = 0;
	while (!options.signal.aborted && !options.isDisabled()) {
		try {
			await options.beforeStart?.();
			if (options.signal.aborted || options.isDisabled()) return;
			await options.spawnBackend();
		} catch (error) {
			console.error("[direct-supervisor] host-service failed", error);
		}
		if (options.signal.aborted || options.isDisabled()) return;
		attempts++;
		await options.waitForRetry(
			Math.min(30_000, 500 * 2 ** Math.min(attempts - 1, 6)),
			options.signal,
		);
	}
}

import { setTimeout as wait } from "node:timers/promises";
