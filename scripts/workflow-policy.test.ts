import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

type Workflow = {
	on: Record<string, unknown>;
	jobs: Record<string, { uses?: string; if?: string }>;
};

const workflows = readdirSync(new URL("../.github/workflows/", import.meta.url))
	.filter((name) => /\.ya?ml$/.test(name))
	.map((name) => ({
		name,
		workflow: Bun.YAML.parse(
			readFileSync(
				new URL(`../.github/workflows/${name}`, import.meta.url),
				"utf8",
			),
		) as Workflow,
	}));

test("fork workflows never start on upstream schedules, repository events, pushes, tags, or pull requests", () => {
	const automatic = workflows.flatMap(({ name, workflow }) =>
		Object.keys(workflow.on)
			.filter(
				(event) => event !== "workflow_dispatch" && event !== "workflow_call",
			)
			.map((event) => `${name}: ${event}`),
	);
	expect(automatic).toEqual([]);
	const manual = workflows
		.filter(({ workflow }) => Object.hasOwn(workflow.on, "workflow_dispatch"))
		.map(({ name }) => name)
		.sort();
	expect(manual).toEqual(["ci.yml", "release-desktop-preview.yml"]);
});

test("manual previews default to no publication or repeated benchmarks", () => {
	const preview = workflows.find(
		({ name }) => name === "release-desktop-preview.yml",
	)!.workflow;
	const dispatch = preview.on.workflow_dispatch as {
		inputs: Record<string, { default: boolean }>;
	};
	for (const flag of [
		"publish",
		"repeat_benchmark",
		"full_benchmark",
		"balanced_benchmark",
	])
		expect(dispatch.inputs[flag]!.default).toBe(false);
	expect(preview.jobs.release!.if).toBe("inputs.publish");
});

test("retained reusable build jobs remain callable without restoring upstream automation", () => {
	const names = new Set(workflows.map(({ name }) => name));
	for (const { workflow } of workflows) {
		for (const job of Object.values(workflow.jobs)) {
			if (!job.uses?.startsWith("./.github/workflows/")) continue;
			const name = job.uses.slice("./.github/workflows/".length);
			expect(names.has(name)).toBe(true);
			expect(
				Object.hasOwn(
					workflows.find((entry) => entry.name === name)!.workflow.on,
					"workflow_call",
				),
			).toBe(true);
		}
	}
});
