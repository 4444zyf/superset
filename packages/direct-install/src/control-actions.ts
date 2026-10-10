// biome-ignore lint/style/noRestrictedImports: Lifecycle commands run in a dedicated installer process.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ActivationJournal,
	assertBackendStopped,
	assertServiceUser,
	atomicPrivateJson,
	backendRequest,
	clearOfflineMaintenance,
	readServiceConfig,
	releaseRootFor,
	type ServiceConfig,
} from "./control-runtime";
import { readPrivateBackendFile } from "./health";
import { acquireInstallerLock } from "./installer-lock";
import {
	assertSafeRestart,
	type ControlRequest,
	compatibleRelease,
	type LifecycleResult,
	type MaintenanceStatus,
} from "./lifecycle";
import { verifyReleaseBundle } from "./release";

export interface ActivationRequestDriver {
	describe(): Promise<{ instanceId: string; version: string }>;
	beginDrain(ownerId: string, freeze: boolean): Promise<MaintenanceStatus>;
	endDrain(ownerId: string): Promise<void>;
	writeJournal(journal: ActivationJournal): void;
	shutdown(ownerId: string): Promise<void>;
}
export async function requestActivation(
	oldConfig: ServiceConfig,
	candidateConfig: ServiceConfig,
	candidateReleaseId: string,
	candidateVersion: string,
	driver: ActivationRequestDriver,
): Promise<LifecycleResult> {
	const transactionId = randomUUID();
	const description = await driver.describe();
	const journal: ActivationJournal = {
		formatVersion: 1,
		transactionId,
		phase: "preparing",
		oldConfig,
		candidateConfig,
		oldInstanceId: description.instanceId,
		oldVersion: description.version,
		candidateVersion,
		candidateReleaseId,
		backups: [],
		error: null,
	};
	driver.writeJournal(journal);
	let draining = false;
	let journalWritten = false;
	try {
		const maintenance = await driver.beginDrain(transactionId, false);
		draining = true;
		try {
			assertSafeRestart(maintenance);
		} catch {
			await driver.endDrain(transactionId);
			draining = false;
			journal.phase = "canceled";
			driver.writeJournal(journal);
			return {
				action: "activate",
				status: "deferred",
				detail:
					"Active or queued work remains; the running backend was preserved",
			};
		}
		const frozen = await driver.beginDrain(transactionId, true);
		assertSafeRestart(frozen);
		if (frozen.ownerId !== transactionId || frozen.frozen !== true)
			throw new Error("Backend did not freeze this activation namespace");
		journal.phase = "quiescing";
		driver.writeJournal(journal);
		journalWritten = true;
		await driver.shutdown(transactionId);
		return {
			action: "activate",
			status: "completed",
			detail:
				"Activation accepted; the remote supervisor finalizes health or rollback independently",
		};
	} catch (error) {
		if (draining && !journalWritten) {
			await driver.endDrain(transactionId);
			journal.phase = "canceled";
			driver.writeJournal(journal);
		}
		throw error;
	}
}

export type UserControlCommand =
	| "metadata"
	| "start"
	| "stop"
	| "stop-owned"
	| "activate"
	| "verify-stopped"
	| "disabled";
export interface ControlMetadata {
	config: ServiceConfig;
	stagedReleaseRoot?: string;
	disabled: boolean;
	retainedReleaseRoots: string[];
}
export function userRetainedReleaseRoots(config: ServiceConfig): string[] {
	const roots = [releaseRootFor(config)];
	const staged = join(config.homeDir, "state/staged-release.json");
	if (existsSync(staged)) {
		const value = JSON.parse(readPrivateBackendFile(staged, 4096)) as {
			releaseRoot: string;
		};
		roots.push(value.releaseRoot);
	}
	const journal = activationJournal(config);
	if (journal) {
		roots.push(
			releaseRootFor(journal.oldConfig),
			releaseRootFor(journal.candidateConfig),
		);
	}
	return [...new Set(roots)];
}
function activationJournal(config: ServiceConfig): ActivationJournal | null {
	const path = join(config.homeDir, "state/activation-journal.json");
	return existsSync(path)
		? (JSON.parse(readPrivateBackendFile(path, 131072)) as ActivationJournal)
		: null;
}
function cancelPending(config: ServiceConfig): void {
	const journal = activationJournal(config);
	if (journal && ["preparing", "quiescing"].includes(journal.phase)) {
		journal.phase = "canceled";
		journal.error = "Explicit lifecycle stop";
		atomicPrivateJson(
			join(config.homeDir, "state/activation-journal.json"),
			journal,
		);
	}
}
export async function controlAsUser(
	request: ControlRequest,
	command: UserControlCommand,
	candidateRoot?: string,
): Promise<unknown> {
	if (
		assertServiceUser() !== request.probe.uid ||
		process.env.HOME !== request.probe.userHome
	)
		throw new Error("Lifecycle service UID changed");
	const configPath = join(
		request.probe.userHome,
		".superset-direct/service-config.json",
	);
	const config = readServiceConfig(configPath);
	const disabled = join(config.homeDir, "state/disabled");
	if (command === "disabled") return { disabled: existsSync(disabled) };
	if (command === "metadata") {
		const stagedPath = join(config.homeDir, "state/staged-release.json");
		const staged = existsSync(stagedPath)
			? (JSON.parse(readPrivateBackendFile(stagedPath, 4096)) as {
					releaseRoot: string;
				})
			: null;
		return {
			config,
			stagedReleaseRoot: staged?.releaseRoot,
			disabled: existsSync(disabled),
			retainedReleaseRoots: userRetainedReleaseRoots(config),
		} satisfies ControlMetadata;
	}
	const release = acquireInstallerLock(
		join(config.homeDir, "state/activation-control.lock"),
	);
	try {
		if (command === "verify-stopped") {
			if (!existsSync(disabled))
				throw new Error(
					"Backend repair requires an explicitly stopped installation",
				);
			assertBackendStopped(config);
			return {
				action: request.action,
				status: "completed",
			} satisfies LifecycleResult;
		}
		if (command === "start") {
			const journal = activationJournal(config);
			if (journal?.phase === "canceled")
				clearOfflineMaintenance(config, journal.transactionId);
			rmSync(disabled, { force: true });
			return { action: "start", status: "completed" } satisfies LifecycleResult;
		}
		if (command === "stop") {
			writeFileSync(disabled, "explicit-lifecycle-stop\n", { mode: 0o600 });
			cancelPending(config);
			const description = await backendRequest<{ instanceId: string }>(
				config,
				"describe",
			).catch(() => null);
			if (description) {
				await backendRequest(config, "shutdown", {
					ownerId: randomUUID(),
					stopTerminals: true,
				});
			}
			return {
				action: request.action,
				status: "completed",
			} satisfies LifecycleResult;
		}
		if (command === "stop-owned") {
			execFileSync(
				join(releaseRootFor(config), "lib/node"),
				[config.hostServicePath, "--stop-owned", "--config", configPath],
				{
					env: {
						HOME: request.probe.userHome,
						PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
					},
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 15000,
				},
			);
			return {
				action: request.action,
				status: "completed",
			} satisfies LifecycleResult;
		}
		if (command !== "activate" || !candidateRoot)
			throw new Error("Unsupported lifecycle user command");
		if (existsSync(disabled))
			return {
				action: "activate",
				status: "deferred",
				detail: "Explicitly stopped backend must be started before activation",
			} satisfies LifecycleResult;
		const previous = activationJournal(config);
		if (
			previous &&
			!["committed", "rolled-back", "canceled"].includes(previous.phase)
		)
			return {
				action: "activate",
				status: "deferred",
				detail: "An activation transaction is already pending",
			} satisfies LifecycleResult;
		const current = verifyReleaseBundle(
			releaseRootFor(config),
			request.trustedKeys,
		);
		const candidate = verifyReleaseBundle(candidateRoot, request.trustedKeys);
		if (
			!compatibleRelease(current.manifest, candidate.manifest) ||
			current.manifest.files.find((file) => file.path === "lib/pty-daemon.js")
				?.sha256 !==
				candidate.manifest.files.find(
					(file) => file.path === "lib/pty-daemon.js",
				)?.sha256
		)
			return {
				action: "activate",
				status: "deferred",
				detail:
					"Schema, migration, Node ABI or PTY changes require a separate stopped upgrade",
			} satisfies LifecycleResult;
		const candidateConfig: ServiceConfig = {
			...config,
			hostServicePath: join(candidateRoot, "lib/host-service-direct.js"),
			migrationsFolder: join(candidateRoot, "share/migrations"),
			chatMigrationsFolder: join(candidateRoot, "lib/chat-migrations"),
		};
		return await requestActivation(
			config,
			candidateConfig,
			candidate.releaseId,
			candidate.manifest.version,
			{
				describe: () => backendRequest(config, "describe"),
				beginDrain: (ownerId, freeze) =>
					backendRequest(config, "begin-drain", { ownerId, freeze }),
				endDrain: async (ownerId) => {
					await backendRequest(config, "end-drain", { ownerId });
				},
				writeJournal: (journal) =>
					atomicPrivateJson(
						join(config.homeDir, "state/activation-journal.json"),
						journal,
					),
				shutdown: async (ownerId) => {
					await backendRequest(config, "shutdown", {
						ownerId,
						stopTerminals: false,
					});
				},
			},
		);
	} finally {
		release();
	}
}
