import type { TerminalVersionReplyOptions } from "./terminal-version-reply";

export function createTerminalReplayGate() {
	let enabled = false;
	let receiving = false;
	let pending = 0;
	const versionReplyOptions: TerminalVersionReplyOptions = {
		enabled: () => enabled,
		canRespond: () => !receiving && pending === 0,
	};
	return {
		versionReplyOptions,
		begin() {
			enabled = true;
			receiving = true;
		},
		end() {
			receiving = false;
		},
		write(
			data: Uint8Array,
			write: (data: Uint8Array, done: () => void) => void,
		) {
			// The boundary can arrive before xterm parses its queued history.
			pending++;
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				pending--;
			};
			try {
				write(data, release);
			} catch (error) {
				release();
				throw error;
			}
		},
	};
}
