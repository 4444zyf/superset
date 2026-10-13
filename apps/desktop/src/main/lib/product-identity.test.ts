import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lockProductProfile } from "./product-identity";

test("packaged branding locks its fresh fork directory before database startup", () => {
	const root = mkdtempSync(path.join(tmpdir(), "fork-profile-"));
	const events: string[] = [];
	try {
		expect(
			lockProductProfile({
				isPackaged: true,
				getPath: () => root,
				getAppPath: () => "/new/application",
				setName: () => events.push("name"),
				setPath: (key, value) => events.push(`${key}:${value}`),
				requestSingleInstanceLock: () => {
					events.push("lock");
					return false;
				},
			}),
		).toBe(false);
		expect(events).toEqual([
			"name",
			`userData:${path.join(root, "superset-remix")}`,
			`sessionData:${path.join(root, "superset-remix")}`,
			"lock",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("development workspaces stay separate from installed preview and official profiles", () => {
	const root = mkdtempSync(path.join(tmpdir(), "fork-dev-profile-"));
	const profiles: string[] = [];
	try {
		for (const workspaceId of ["a", "b"])
			lockProductProfile(
				{
					isPackaged: false,
					getPath: () => root,
					getAppPath: () => "/checkout",
					setName: () => {},
					setPath: (key, value) => {
						if (key === "userData") profiles.push(value);
					},
					requestSingleInstanceLock: () => true,
				},
				workspaceId,
			);
		expect(profiles[0]).not.toBe(profiles[1]);
		for (const profile of profiles) {
			expect(path.basename(profile)).toMatch(
				/^superset-remix-dev-[a-f0-9]{64}$/,
			);
			expect(path.basename(profile)).not.toBe("Superset SSH Preview");
			expect(path.basename(profile)).not.toBe("Superset");
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
