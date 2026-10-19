export class ScreenHistory {
	private retained: string[] = [];
	private previous: string[] = [];
	constructor(
		private readonly limits = { maxLines: 10000, maxChars: 1024 * 1024 },
	) {}
	capture(input: string[]) {
		const lines: string[] = [];
		let screenBudget = this.limits.maxChars;
		for (
			let i = input.length - 1;
			i >= 0 &&
			lines.length < Math.min(1000, this.limits.maxLines) &&
			screenBudget > 0;
			i--
		) {
			const line = input[i].slice(-screenBudget);
			lines.push(line);
			screenBudget -= line.length + 1;
		}
		lines.reverse();
		if (!lines.some((line) => line.length)) return;
		if (
			lines.length === this.previous.length &&
			lines.every((line, i) => line === this.previous[i])
		)
			return;
		let overlap = Math.min(lines.length, this.previous.length);
		for (; overlap > 0; overlap--) {
			if (
				lines
					.slice(0, overlap)
					.every(
						(line, i) =>
							line === this.previous[this.previous.length - overlap + i],
					)
			)
				break;
		}
		if (!overlap && this.retained.length) this.retained.push("");
		this.retained.push(...lines.slice(overlap));
		this.retained = this.retained.slice(-this.limits.maxLines);
		let budget = this.limits.maxChars;
		for (let i = this.retained.length - 1; i >= 0; i--) {
			const line = this.retained[i];
			if (line.length + 1 > budget) {
				this.retained = this.retained.slice(i + 1);
				if (budget > 1) this.retained.unshift(line.slice(-(budget - 1)));
				break;
			}
			budget -= line.length + 1;
		}
		this.previous = lines;
	}
	lines() {
		return this.retained.slice();
	}
	clear() {
		this.retained = [];
		this.previous = [];
	}
}
