import { randomUUID } from "node:crypto";
import type { DirectSetupSnapshot } from "../../../shared/direct-workstation";

interface Job {
	snapshot: DirectSetupSnapshot;
	started: number;
	phaseStarted: number;
	pending?: Promise<unknown>;
}
export class SetupProgress {
	private readonly jobs = new Map<string, Job>();
	constructor(
		private readonly notify: (snapshot: DirectSetupSnapshot) => void,
		private readonly now = () => performance.now(),
	) {}
	get(id: string): DirectSetupSnapshot | null {
		const job = this.jobs.get(id);
		if (!job) return null;
		const snapshot = structuredClone(job.snapshot);
		if (snapshot.status === "running")
			snapshot.elapsedMs = this.now() - job.started;
		return snapshot;
	}
	phase(id: string, phase: DirectSetupSnapshot["phase"]): void {
		const job = this.jobs.get(id);
		if (
			!job ||
			job.snapshot.status !== "running" ||
			job.snapshot.phase === phase
		)
			return;
		const now = this.now();
		job.snapshot.steps.push({
			phase: job.snapshot.phase,
			elapsedMs: now - job.phaseStarted,
		});
		job.snapshot.steps = job.snapshot.steps.slice(-24);
		job.phaseStarted = now;
		job.snapshot.phase = phase;
		job.snapshot.elapsedMs = now - job.started;
		job.snapshot.sequence++;
		this.notify(structuredClone(job.snapshot));
	}
	run<T>(id: string, action: () => Promise<T>): Promise<T> {
		const current = this.jobs.get(id);
		if (current?.pending) return current.pending as Promise<T>;
		while (this.jobs.size >= 50) {
			const removable = [...this.jobs].find(([, value]) => !value.pending);
			if (!removable) throw new Error("Too many active connection tasks");
			this.jobs.delete(removable[0]);
		}
		const now = this.now();
		const job: Job = {
			started: now,
			phaseStarted: now,
			snapshot: {
				connectionId: id,
				jobId: randomUUID(),
				generation: (current?.snapshot.generation ?? 0) + 1,
				sequence: 1,
				status: "running",
				phase: "connecting",
				elapsedMs: 0,
				steps: [],
			},
		};
		this.jobs.set(id, job);
		this.notify(structuredClone(job.snapshot));
		const finish = (status: "completed" | "failed") => {
			job.snapshot.steps.push({
				phase: job.snapshot.phase,
				elapsedMs: this.now() - job.phaseStarted,
			});
			job.snapshot.status = status;
			job.snapshot.elapsedMs = this.now() - job.started;
			job.snapshot.sequence++;
			job.pending = undefined;
			this.notify(structuredClone(job.snapshot));
		};
		job.pending = Promise.resolve()
			.then(action)
			.then(
				(result) => {
					finish("completed");
					return result;
				},
				(error) => {
					finish("failed");
					throw error;
				},
			);
		return job.pending as Promise<T>;
	}
}
