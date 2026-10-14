import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationGitHistoryUi({
	getPage,
	click,
	screenshot,
	output,
}) {
	const evaluate = (expression) => getPage().evaluate(expression);
	const until = async (read, predicate = Boolean) => {
		for (let i = 0; i < 150; i++) {
			const value = await read();
			if (predicate(value)) return value;
			await delay(50);
		}
		throw new Error("Repository history UI acceptance did not complete");
	};
	const descriptor = await evaluate(
		"(async()=>{return (await window.directWorkstation.getWorkspaceRestore()).descriptor;})()",
	);
	assert.equal(descriptor.capabilities.workstationGitHistoryV1, true);
	await click("text:Files");
	await click("text:History");
	const commit = await until(() =>
		evaluate(
			"(()=>{const e=[...document.querySelectorAll('[data-history-commit]')].find(e=>e.textContent.includes('Feature parity commit')&&!e.disabled);return e?{hash:e.dataset.historyCommit,text:e.textContent}:null;})()",
		),
	);
	await screenshot("git-original-history-rows");
	await click(`[data-history-commit=${JSON.stringify(commit.hash)}]`);
	const file = '[data-git-path="feature-native.txt"] button';
	await until(() =>
		evaluate(
			`document.querySelector(${JSON.stringify(file)})?.disabled===false`,
		),
	);
	await click(file);
	const contents = await until(() =>
		evaluate(
			"(()=>{const root=document.querySelector('[data-remote-git-diff=\"feature-native.txt\"] diffs-container')?.shadowRoot;const lines=root?[...root.querySelectorAll('[data-line][data-line-type*=addition]')].map(e=>e.textContent).join('\\n'):'';return lines||null;})()",
		),
	);
	assert.ok(contents.includes("feature search candidate"));
	assert.ok(!contents.includes("first retained editor draft"));
	await screenshot("git-selected-commit-immutable-diff");
	await click("text:Terminal");
	writeFileSync(
		join(output, "workstation-git-history-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalCommitRows: true,
				selectedCommit: commit,
				immutableSelectedCommitContents: contents,
				excludedUncommittedDraft: true,
			},
			null,
			2,
		) + "\n",
	);
}
