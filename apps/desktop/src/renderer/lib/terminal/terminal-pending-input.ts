import type { IDisposable, Terminal } from "@xterm/xterm";

export class TerminalPendingInput {
	private data = "";
	private queuedAt: number | undefined;
	private overflowed = false;

	constructor(private readonly now: () => number = Date.now) {}

	queue(data: string): void {
		if (!data || this.overflowed) return;
		this.queuedAt ??= this.now();
		if (this.data.length + data.length > 8192) {
			this.data = "";
			this.overflowed = true;
			return;
		}
		this.data += data;
	}

	take(): string {
		const data = this.data;
		const queuedAt = this.queuedAt;
		this.clear();
		if (queuedAt === undefined) return "";
		const age = this.now() - queuedAt;
		return age >= 0 && age <= 5000 ? data : "";
	}

	clear(): void {
		this.data = "";
		this.queuedAt = undefined;
		this.overflowed = false;
	}
}

export function listenTerminalInput(
	terminal: Pick<Terminal, "onData"> & Partial<Pick<Terminal, "onBinary">>,
	listener: (data: string, userInput: boolean) => void,
	binaryListener?: (data: string) => void,
): IDisposable {
	let userInput = false;
	// onData merges user input and parser replies. The pinned core announces
	// user input synchronously before its data event; older cores fall back
	// to live-only delivery rather than guessing from escape-sequence content.
	const core = terminal as unknown as {
		_core?: {
			coreService?: {
				onUserInput?: (listener: () => void) => IDisposable;
			};
		};
	};
	const user = core._core?.coreService?.onUserInput?.(() => {
		userInput = true;
	});
	const data = terminal.onData((value) => {
		const fromUser = userInput;
		userInput = false;
		listener(value, fromUser);
	});
	const binary =
		binaryListener &&
		terminal.onBinary?.((value) => {
			userInput = false;
			binaryListener(value);
		});
	return {
		dispose() {
			data.dispose();
			binary?.dispose();
			user?.dispose();
			userInput = false;
		},
	};
}
