import { expect, mock, test } from "bun:test";
import { DaemonSupervisor } from "./DaemonSupervisor";

test("direct mode adopts a degraded daemon without automatically destroying its sessions", async () => {
	const supervisor = new DaemonSupervisor({
		scriptPath: "/unused/pty-daemon.js",
		autoUpdate: false,
		preserveExistingSessions: true,
		hostTrustdProbe: async () => true,
	});
	const instance = {
		pid: process.pid,
		socketPath: "/unused/pty.sock",
		startedAt: Date.now(),
		runningVersion: "0.0.1",
		expectedVersion: "0.0.2",
		updatePending: true,
		unreachableSince: null,
		trustdHealthy: false,
	};
	const internal = supervisor as unknown as {
		tryAdopt: () => Promise<typeof instance>;
		killAdoptedDaemon: () => Promise<void>;
		startHealthPoll: () => void;
	};
	internal.tryAdopt = async () => instance;
	const kill = mock(async () => { throw new Error("Destructive kill blocked by regression fixture"); });
	internal.killAdoptedDaemon = kill;
	internal.startHealthPoll = () => {};
	expect(await supervisor.ensure("direct-namespace")).toBe(instance);
	expect(kill).not.toHaveBeenCalled();
});
