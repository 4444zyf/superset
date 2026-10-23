import {
	ControlSequenceScanner,
	type ControlSequenceScannerSnapshot,
} from "@superset/pty-daemon/terminal-modes";

export class TerminalVersionQueries {
	private count = 0;
	private scanner = new ControlSequenceScanner({
		escape() {},
		osc() {},
		csi: (sequence, final) => {
			if (final !== "q" || !/^>[\d;:]*$/.test(sequence)) return;
			const first = sequence.slice(1).split(";", 1)[0] ?? "";
			if (first.includes(":") || Number(first) === 0) this.count++;
		},
	});

	feed(bytes: Uint8Array): number {
		this.count = 0;
		this.scanner.feed(bytes);
		return this.count;
	}

	restoreParser(snapshot: ControlSequenceScannerSnapshot): void {
		this.scanner.restore(snapshot);
	}
}

export class TerminalVersionReplies {
	private pending = 0;

	expect(count: number): void {
		this.pending = Math.min(Number.MAX_SAFE_INTEGER, this.pending + count);
	}

	allowsInput(data: string): boolean {
		// Released xterm renderers emit each protocol response in one onData
		// event. Leave pasted text, keyboard input and other query families alone.
		if (!data.startsWith("\x1bP>|") || !data.endsWith("\x1b\\")) return true;
		for (const char of data.slice(4, -2)) {
			const code = char.charCodeAt(0);
			if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
		}
		if (this.pending === 0) return false;
		this.pending--;
		return true;
	}
}
