import { useCallback, useEffect, useRef, useState } from "react";

export function useScopedAsync(
	scope: string,
	onError: (error: unknown) => void,
) {
	const mounted = useRef(false);
	const current = useRef({ scope, epoch: 0 });
	if (current.current.scope !== scope)
		current.current = { scope, epoch: current.current.epoch + 1 };
	const sequence = useRef(0);
	const errorHandler = useRef(onError);
	errorHandler.current = onError;
	const [pending, setPending] = useState<{
		epoch: number;
		sequence: number;
	} | null>(null);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			sequence.current++;
		};
	}, []);
	const run = useCallback(
		async <T>(task: () => Promise<T>, apply?: (result: T) => void) => {
			const operation = {
				epoch: current.current.epoch,
				sequence: ++sequence.current,
			};
			const isCurrent = () =>
				mounted.current &&
				current.current.epoch === operation.epoch &&
				sequence.current === operation.sequence;
			setPending(operation);
			try {
				const result = await task();
				if (isCurrent()) apply?.(result);
			} catch (error) {
				if (isCurrent()) errorHandler.current(error);
			} finally {
				if (isCurrent()) setPending(null);
			}
		},
		[],
	);
	return {
		busy:
			pending !== null &&
			pending.epoch === current.current.epoch &&
			pending.sequence === sequence.current,
		run,
	};
}
