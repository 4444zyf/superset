import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = (name: string) =>
	Bun.YAML.parse(
		readFileSync(
			resolve(import.meta.dir, "../../../.github/workflows", name),
			"utf8",
		),
	) as {
		jobs: Record<
			string,
			{
				needs?: string | string[];
				uses?: string;
				"runs-on"?: string;
				strategy?: {
					matrix: { include: Array<{ os: string; target: string }> };
				};
				steps?: Array<{
					name?: string;
					uses?: string;
					run?: string;
					with?: Record<string, unknown>;
					env?: Record<string, string>;
				}>;
			}
		>;
	};

test("desktop release jobs await dual native signed backends and verify staged resources before and after packaging", () => {
	const build = workflow("build-desktop.yml");
	expect(build.jobs["direct-backends"]?.uses).toBe(
		"./.github/workflows/build-direct.yml",
	);
	for (const jobName of ["build-macos", "build-linux"]) {
		const job = build.jobs[jobName];
		expect(job?.needs).toContain("direct-backends");
		const steps = job?.steps ?? [];
		const compile = steps.findIndex((step) =>
			step.run?.includes("bun run compile:app"),
		);
		const stage = steps.findIndex(
			(step) =>
				step.run?.includes("stage:direct-resources") &&
				!step.run?.includes("--verify"),
		);
		const pack = steps.findIndex((step) =>
			step.run?.includes("bun run package"),
		);
		const verify = steps.findIndex(
			(step) =>
				(step.run?.includes("stage:direct-resources") ||
					step.run?.includes("stage-direct-resources.ts")) &&
				step.run?.includes("--verify"),
		);
		expect(stage).toBeGreaterThan(compile);
		expect(pack).toBeGreaterThan(stage);
		expect(verify).toBeGreaterThan(pack);
		expect(steps[pack]?.env?.DIRECT_RELEASE_PUBLIC_KEYS_JSON).toBe(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: This is a GitHub Actions expression.
			"${{ secrets.DIRECT_RELEASE_PUBLIC_KEYS_JSON }}",
		);
	}
});

test("direct backend workflow uses separate native Mac workers and signs before uploading complete payload artifacts", () => {
	const direct = workflow("build-direct.yml");
	const job = direct.jobs.build;
	expect(job?.strategy?.matrix.include).toEqual([
		{ os: "macos-14", target: "darwin-arm64" },
		{ os: "macos-15-intel", target: "darwin-x64" },
	]);
	expect(job?.["runs-on"]).toBe(
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This is a GitHub Actions expression.
		"${{ matrix.os }}",
	);
	const steps = job?.steps ?? [];
	const prepare = steps.findIndex((step) =>
		step.run?.includes("prepare-direct-signing.ts"),
	);
	const build = steps.findIndex((step) => step.run?.includes("build:direct"));
	const upload = steps.findIndex((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	);
	expect(prepare).toBeGreaterThan(-1);
	expect(build).toBeGreaterThan(prepare);
	expect(upload).toBeGreaterThan(build);
	expect(steps[build]?.run).toContain("--trusted-keys-file=");
	expect(steps[build]?.run).toContain("--codesign-identity=");
	expect(steps[upload]?.with?.["if-no-files-found"]).toBe("error");
	expect(steps[upload]?.with?.name).toBe(
		// biome-ignore lint/suspicious/noTemplateCurlyInString: These are GitHub Actions expressions.
		"direct-backend-${{ inputs.artifact_prefix }}-${{ matrix.target }}",
	);
});
