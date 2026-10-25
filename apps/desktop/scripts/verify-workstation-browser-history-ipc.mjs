import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function verifyWorkstationBrowserHistoryIpc({
	getPage,
	evaluateMain,
	restart,
	profile,
	output,
	source,
}) {
	const report = {
		kind: "Native workstation IPC and SQLite integration; browser UI not exercised",
		source,
		profile,
		available: await getPage().evaluate(
			"Boolean(window.directWorkstation.browser?.history)",
		),
	};
	const save = () =>
		writeFileSync(
			join(output, "browser-history-ipc.json"),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	save();
	assert.equal(
		report.available,
		true,
		"workstation browser history IPC is available",
	);
	const evaluate = (expression) =>
		getPage().evaluate(
			`(async()=>{const history=window.directWorkstation.browser.history;return ${expression};})()`,
		);
	assert.deepEqual(await evaluate("await history.getAll()"), []);
	const url = "https://owned.invalid/中文?value='literal'";
	await evaluate(
		`await history.upsert(${JSON.stringify({ url, title: "First visit", faviconUrl: "https://owned.invalid/icon.png" })})`,
	);
	const [first] = await evaluate("await history.getAll()");
	assert.equal(first.url, url);
	assert.equal(first.visitCount, 1);
	await evaluate(
		`await history.upsert(${JSON.stringify({ url, title: "第二次 🙂" })})`,
	);
	const [second] = await evaluate("await history.getAll()");
	assert.equal(second.id, first.id);
	assert.equal(second.visitCount, 2);
	assert.equal(second.title, "第二次 🙂");
	assert.equal(second.faviconUrl, null);
	assert.deepEqual(
		await evaluate(
			`await history.search(${JSON.stringify({ query: "第二次", limit: 1 })})`,
		),
		[second],
	);
	report.beforeClose = second;
	save();
	await restart();
	assert.deepEqual(await evaluate("await history.getAll()"), [second]);
	report.afterReopen = await evaluate("await history.getAll()");
	const filename = join(profile, "direct-workstation/browser-history.db");
	report.storage = await evaluateMain(`(()=>{
		const filename=${JSON.stringify(filename)};
		const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/owned-browser-history-probe.cjs');
		const db=new (require('better-sqlite3'))(filename,{readonly:true,fileMustExist:true});
		try{return {mode:process.getBuiltinModule('fs').statSync(filename).mode&0o777,tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()};}
		finally{db.close();}
	})()`);
	assert.equal(report.storage.mode, 0o600);
	assert.deepEqual(report.storage.tables, [{ name: "browser_history" }]);
	await evaluate("await history.clear()");
	assert.deepEqual(await evaluate("await history.getAll()"), []);
	await restart();
	report.afterClearReopen = await evaluate("await history.getAll()");
	assert.deepEqual(report.afterClearReopen, []);
	report.errors = getPage().errors;
	assert.deepEqual(report.errors, []);
	save();
}
