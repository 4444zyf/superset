const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

async function verify() {
	const [app, arch, version] = process.argv.slice(2);
	assert.equal(process.platform, "darwin");
	assert.equal(process.arch, arch);
	const resources = path.join(app, "Contents/Resources");
	const asar = path.join(resources, "app.asar");
	const metadata = JSON.parse(fs.readFileSync(path.join(asar, "package.json")));
	assert.equal(metadata.productName, "Superset SSH Preview");
	assert.equal(metadata.name, "superset-ssh-preview");
	assert.equal(metadata.version, version);
	for (const name of ["direct-backend", "direct-release-keys.json"]) {
		assert.equal(fs.existsSync(path.join(resources, "resources", name)), false);
		assert.equal(fs.existsSync(path.join(asar, "dist/resources", name)), false);
	}
	for (const name of [
		"index.js",
		"direct-backend.js",
		"direct-supervisor.js",
		"host-worker.js",
		"pty-daemon.js",
	]) {
		assert.ok(fs.statSync(path.join(asar, "dist/main", name)).isFile());
	}
	for (const name of ["migrations", "host-migrations", "chat-migrations"]) {
		assert.ok(
			fs
				.statSync(path.join(resources, "resources", name, "meta/_journal.json"))
				.isFile(),
		);
	}
	const requireApp = createRequire(path.join(asar, "package.json"));
	const Database = requireApp("better-sqlite3");
	const db = new Database(":memory:");
	try {
		assert.equal(db.prepare("SELECT 42 AS value").get().value, 42);
	} finally {
		db.close();
	}
	const temporary = fs.mkdtempSync(
		path.join(os.tmpdir(), "superset-preview-pty-"),
	);
	try {
		const pty = requireApp("node-pty");
		await new Promise((resolve, reject) => {
			const terminal = pty.spawn(
				"/bin/sh",
				[
					"-c",
					"read -r preview_line; printf 'preview-pty-ok\\n'; read -r preview_line",
				],
				{ cwd: temporary, env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" } },
			);
			let output = "";
			let acknowledged = false;
			const deadline = setTimeout(() => {
				terminal.kill();
				reject(new Error("Packaged native PTY did not finish"));
			}, 3000);
			terminal.onData((data) => {
				output += data;
				if (!acknowledged && output.includes("preview-pty-ok")) {
					acknowledged = true;
					terminal.write("done\n");
				}
			});
			terminal.onExit(({ exitCode }) => {
				clearTimeout(deadline);
				if (exitCode === 0 && output.includes("preview-pty-ok")) resolve();
				else reject(new Error("Packaged native PTY output or exit mismatch"));
			});
			terminal.write("go\n");
		});
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
	console.log(
		JSON.stringify({
			arch,
			version,
			appIdentity: "Superset SSH Preview",
			abi: process.versions.modules,
			nativeSQLite: "pass",
			nativePty: "pass",
			managedBackendResources: false,
		}),
	);
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
