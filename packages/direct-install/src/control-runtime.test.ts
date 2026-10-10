import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ActivationDriver,
	type ActivationJournal,
	advanceActivation,
	finishPendingActivation,
	requestBackendSocket,
} from "./control-runtime";

function fixture(phase: ActivationJournal["phase"] = "quiescing") {
	const calls: string[] = [];
	const oldConfig = {
		backendId: "11111111-1111-1111-1111-111111111111",
		namespaceId: "22222222-2222-2222-2222-222222222222",
		homeDir: "/Users/alice/.superset-direct",
		secretFile: "/Users/alice/.superset-direct/credentials/host-secret",
		migrationsFolder: "/runtime/old/share/migrations",
		hostServicePath: "/runtime/old/lib/host-service-direct.js",
		allowedOrigins: [],
	};
	const journal: ActivationJournal = {
		formatVersion: 1,
		transactionId: "33333333-3333-3333-3333-333333333333",
		phase,
		oldConfig,
		candidateConfig: {
			...oldConfig,
			hostServicePath: "/runtime/new/lib/host-service-direct.js",
		},
		oldInstanceId: "old",
		oldVersion: "1.0.0",
		candidateVersion: "1.0.1",
		candidateReleaseId: "new",
		backups: [],
		error: null,
	};
	const driver: ActivationDriver = {
		writeJournal(j) {
			calls.push(`journal:${j.phase}`);
		},
		assertHostStopped() {
			calls.push("stopped");
		},
		async backup() {
			calls.push("backup");
			return [{ database: "host.db", backupPath: "/backup/host.db" }];
		},
		switchConfig(config) {
			calls.push(config === oldConfig ? "config:old" : "config:new");
		},
		async restore() {
			calls.push("restore");
		},
		async verify() {
			calls.push("verify");
		},
		async endDrain() {
			calls.push("end-drain");
		},
		async stopCurrent() {
			calls.push("stop-host");
		},
		async verifyQuiescent() {
			calls.push("verify-quiescent");
		},
		async prepareQuiescence() {
			return true;
		},
		cancelPreparation() {
			calls.push("cancel-preparation");
		},
	};
	return { journal, driver, calls };
}
test("backs up only after the previous host is stopped and keeps the candidate frozen until health passes", async () => {
	const f = fixture();
	await advanceActivation(f.journal, "before-start", f.driver);
	expect(f.calls).toEqual([
		"stopped",
		"backup",
		"journal:backed-up",
		"config:new",
		"journal:verifying",
	]);
	await advanceActivation(f.journal, "after-start", f.driver);
	expect(f.calls.slice(-4)).toEqual([
		"verify",
		"journal:committing",
		"end-drain",
		"journal:committed",
	]);
});
test("candidate health failure stops only the owned host and rolls back data before old code can start", async () => {
	const f = fixture("verifying");
	f.driver.verify = async () => {
		throw new Error("candidate unhealthy");
	};
	await advanceActivation(f.journal, "after-start", f.driver);
	expect(f.calls).toEqual(["stop-host", "journal:rolling-back"]);
	await advanceActivation(f.journal, "before-start", f.driver);
	expect(f.calls.slice(-4)).toEqual([
		"stopped",
		"restore",
		"config:old",
		"journal:rollback-verifying",
	]);
});
test("a lost commit acknowledgement never restores a backup over newly accepted writes", async () => {
	const f = fixture("verifying");
	f.driver.endDrain = async () => {
		f.calls.push("end-drain");
		throw new Error("response lost after release");
	};
	await expect(
		advanceActivation(f.journal, "after-start", f.driver),
	).rejects.toThrow("response lost");
	expect(f.journal.phase).toBe("committing");
	expect(f.calls).not.toContain("restore");
	expect(f.calls).not.toContain("stop-host");
	f.driver.endDrain = async () => {
		f.calls.push("end-drain");
	};
	await advanceActivation(f.journal, "after-start", f.driver);
	expect(f.journal.phase).toBe("committed");
});
test("backup failure returns to the untouched old host without pretending the candidate ran", async () => {
	const f = fixture();
	f.driver.backup = async () => {
		throw new Error("disk full");
	};
	await advanceActivation(f.journal, "before-start", f.driver);
	expect(f.journal.phase).toBe("rollback-verifying");
	expect(f.calls).not.toContain("config:new");
	expect(f.calls).not.toContain("restore");
});
test("the resident finalizer can resume a frozen transaction before the SSH shutdown request was sent", async () => {
	const f = fixture();
	await advanceActivation(f.journal, "after-start", f.driver);
	expect(f.calls).toEqual(["verify-quiescent", "stop-host"]);
	expect(f.journal.phase).toBe("quiescing");
});
test("an interrupted preparing intent can restart the old host after that host exits", async () => {
	const f = fixture("preparing");
	await advanceActivation(f.journal, "before-start", f.driver);
	expect(f.calls).toEqual([
		"stopped",
		"cancel-preparation",
		"journal:canceled",
	]);
	expect(f.calls).not.toContain("config:new");
});
test("local supervisor startup without an installation journal does not require an installed root release", async () => {
	const root = mkdtempSync(join(tmpdir(), "direct-local-"));
	try {
		await finishPendingActivation(join(root, "local-config.json"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
test("backend control sends credentials only through the Unix socket and refuses redirects", async () => {
	const root = mkdtempSync(join(tmpdir(), "direct-http-"));
	const socket = join(root, "control.sock");
	let requests = 0;
	const server = createServer((req, res) => {
		requests++;
		expect(req.headers.authorization).toBe("Bearer one-time-test-key");
		res.writeHead(302, { Location: "http://127.0.0.1:1/steal" });
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(socket, resolve));
	try {
		await expect(
			requestBackendSocket(socket, "describe", "one-time-test-key"),
		).rejects.toThrow("302");
		expect(requests).toBe(1);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});

test("a config publication failure retains the completed backup phase for an independent retry", async () => {
	const f = fixture("backed-up");
	const publish = f.driver.switchConfig;
	f.driver.switchConfig = () => {
		throw new Error("rename failed");
	};
	await expect(
		advanceActivation(f.journal, "before-start", f.driver),
	).rejects.toThrow("rename failed");
	expect(f.journal.phase).toBe("backed-up");
	f.driver.switchConfig = publish;
	await advanceActivation(f.journal, "before-start", f.driver);
	expect(f.journal.phase).toBe("verifying");
});
test("a partial restore failure cannot start any host before restoration succeeds", async () => {
	const f = fixture("rolling-back");
	f.driver.restore = async () => {
		throw new Error("restore disk full");
	};
	await expect(
		advanceActivation(f.journal, "before-start", f.driver),
	).rejects.toThrow("disk full");
	expect(f.journal.phase).toBe("rolling-back");
	expect(f.calls).not.toContain("config:old");
});
