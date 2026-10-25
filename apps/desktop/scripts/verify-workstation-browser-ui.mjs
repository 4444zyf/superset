import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationBrowserUi(options) {
	const { output, screenshot, click, getPage, controls, closeReopen } = options;
	const { evaluate, until } = agentUiDriver(options);
	const available = await evaluate(
		"Boolean(document.querySelector('[data-workstation-new-browser]'))",
	);
	writeFileSync(
		join(output, "browser-ui.json"),
		JSON.stringify({ available }, null, 2) + "\n",
	);
	await screenshot("browser-entry");
	assert.equal(available, true, "workspace browser entry is visible");
	const scope =
		options.scope ??
		(await evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceViewV2();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);const row=await window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});return {d,w,root:row.worktreePath};})()`,
		));
	const rpc = (path, input) =>
		evaluate(
			`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.d.connectionId, generation: scope.d.generation, path, type: "query", input })})`,
		);
	const readView = () =>
		evaluate("window.directWorkstation.getWorkspaceViewV2()");
	const workspace = (result) =>
		result.snapshot.targets
			.find((t) => t.connectionId === scope.d.connectionId)
			.workspaces.find((w) => w.workspaceId === scope.w.workspaceId);
	await click("text:New terminal");
	const terminal = await until(
		() =>
			evaluate(
				`[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,state:e.dataset.restoreState})).find(e=>e.state==='attached'&&!${JSON.stringify(scope.w.panes.map((p) => p.resourceId))}.includes(e.id))`,
			),
		"HTTP fixture terminal attached",
	);
	const selector = `[data-terminal-id="${terminal.id}"]`;
	const marker = `OWNED-BROWSER-${randomUUID()}`;
	const script = [
		"import http.server,json,os,signal",
		"from pathlib import Path",
		`state={"marker":${JSON.stringify(marker)},"requests":[],"running":True,"pid":os.getpid()}`,
		"def save(): Path('browser-proof.json').write_text(json.dumps(state))",
		"class Handler(http.server.BaseHTTPRequestHandler):",
		" def do_GET(self):",
		"  state['requests'].append(self.path);save()",
		`  title='Owned browser '+('next' if self.path.startswith('/next') else 'home')+' 中文 🙂'`,
		`  body=('<!doctype html><meta charset="utf-8"><title>'+title+'</title><h1>'+state['marker']+'</h1><a id="next" href="/next?value=%E4%B8%AD%20hello#section">Next page</a><p>needle needle needle</p>').encode()`,
		"  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)",
		" def log_message(self,*args): pass",
		"server=http.server.HTTPServer(('127.0.0.1',0),Handler)",
		"state['port']=server.server_port;save()",
		"try: server.serve_forever()",
		"except KeyboardInterrupt: pass",
		"finally: server.server_close();state['running']=False;save()",
	].join("\n");
	const command = `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(script).toString("base64")}"))'`;
	const key = async (key, code, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				modifiers,
				...(key === "Enter" && type === "keyDown"
					? { text: "\r", unmodifiedText: "\r" }
					: {}),
				windowsVirtualKeyCode:
					key === "Enter" ? 13 : key === "Escape" ? 27 : 67,
			});
	};
	const readProof = async () => {
		const row = await rpc("filesystem.readFile", {
			workspaceId: scope.w.workspaceId,
			absolutePath: `${scope.root}/browser-proof.json`,
			maxBytes: 16384,
		});
		return JSON.parse(
			row.kind === "bytes"
				? Buffer.from(row.content, "base64").toString()
				: row.content,
		);
	};
	const report = { available, scope, marker };
	const save = () =>
		writeFileSync(
			join(output, "browser-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	const guestRead = (expression) =>
		evaluate(
			`(async()=>{const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible'&&e.getBoundingClientRect().width>0);if(!v)return null;try{return await v.executeJavaScript(${JSON.stringify(expression)});}catch{return null;}})()`,
		);
	let started = false,
		terminalTab;
	try {
		await click(`${selector} .xterm-screen`);
		await getPage().call("Input.insertText", { text: command });
		await key("Enter", "Enter");
		const proof = await until(async () => {
			try {
				const p = await readProof();
				return p.marker === marker ? p : null;
			} catch {
				return null;
			}
		}, "owned HTTP fixture listening");
		started = true;
		report.terminalBefore = await controls.inspectPresetTerminal(terminal.id);
		const before = workspace(await readView());
		terminalTab = before.paneTabs?.find((t) =>
			JSON.stringify(t.layout).includes(
				before.panes.find((p) => p.resourceId === terminal.id).paneId,
			),
		)?.tabId;
		assert.ok(terminalTab);
		await click("[data-workstation-new-browser]");
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-browser-pane]'))",
				),
			"browser page mounted",
		);
		await evaluate(
			`(()=>{window.__ownedBrowserEvents=[];const v=document.querySelector('webview');for(const type of ['dom-ready','did-navigate','did-navigate-in-page','page-title-updated','did-stop-loading'])v.addEventListener(type,event=>{window.__ownedBrowserEvents.push({type,title:event.title,url:event.url});if(window.__ownedBrowserEvents.length>64)window.__ownedBrowserEvents.shift();});return true;})()`,
		);
		const url = `http://localhost:${proof.port}/preview?first=%E4%B8%AD#initial`;
		await click("text:Enter URL or search...");
		await click('input[placeholder="Enter URL or search..."]');
		await getPage().call("Input.insertText", { text: url });
		await key("Enter", "Enter");
		const loaded = await until(async () => {
			const value = await guestRead(
				"({body:document.body.innerText,title:document.title,url:location.href,node:typeof require,process:typeof process})",
			);
			return value?.body.includes(marker) ? value : null;
		}, "owned page rendered inside Electron guest");
		assert.equal(loaded.node, "undefined");
		assert.equal(loaded.process, "undefined");
		report.loaded = loaded;
		await screenshot("browser-owned-page");
		await click('button[aria-label="Find in page"]');
		await getPage().call("Input.insertText", { text: "needle" });
		await until(
			() =>
				evaluate(
					`document.querySelector('input[placeholder="Find in page"]')?.parentElement.textContent.includes('1/3')`,
				),
			"native find-in-page reports real matches",
		);
		await screenshot("browser-find-in-page");
		await click('button[aria-label="Close find bar"]');
		const point = await evaluate(
			`(async()=>{const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible');const inner=await v.executeJavaScript("(()=>{const r=document.querySelector('#next').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");const r=v.getBoundingClientRect();return {x:r.x+inner.x,y:r.y+inner.y};})()`,
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...point,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		await until(
			async () =>
				(await guestRead("document.title")) === "Owned browser next 中文 🙂",
			"guest link navigation",
		);
		const nav =
			"[data-workstation-browser-toolbar] > div > div:first-child > button";
		await click(`${nav}:nth-child(1)`);
		await until(
			async () =>
				(await guestRead("document.title")) === "Owned browser home 中文 🙂",
			"browser back",
		);
		await click(`${nav}:nth-child(2)`);
		await until(
			async () =>
				(await guestRead("document.title")) === "Owned browser next 中文 🙂",
			"browser forward",
		);
		await click(`${nav}:nth-child(3)`);
		await until(
			async () =>
				(await readProof()).requests.filter((p) => p.startsWith("/next?"))
					.length >= 2,
			"browser reload reaches actual server",
		);
		await until(
			async () =>
				workspace(await readView()).panes.some(
					(p) =>
						p.kind === "browser" &&
						p.browser.url ===
							`http://localhost:${proof.port}/next?value=%E4%B8%AD%20hello#section` &&
						p.browser.pageTitle === "Owned browser next 中文 🙂",
				),
			"canonical page metadata persisted",
		);
		report.beforeReopen = workspace(await readView());
		report.history = await evaluate(
			"window.directWorkstation.browser.history.getAll()",
		);
		assert.ok(
			report.history.some(
				(row) =>
					row.url ===
					`http://localhost:${proof.port}/next?value=%E4%B8%AD%20hello#section`,
			),
		);
		report.rendererBeforeReopen = getPage().errors;
		assert.deepEqual(report.rendererBeforeReopen, []);
		save();
		await closeReopen();
		await until(
			async () =>
				(await guestRead("document.title")) === "Owned browser next 中文 🙂",
			"saved browser page after normal reopen",
		);
		report.afterReopen = workspace(await readView());
		report.terminalAfter = await controls.inspectRunExecution(
			{
				terminalId: terminal.id,
				executionId: report.terminalBefore.executionId,
			},
			report.terminalBefore.pid,
		);
		assert.equal(report.terminalAfter.alive, true);
		assert.equal(report.terminalAfter.cwd, report.terminalBefore.cwd);
		report.rendererAfterReopen = getPage().errors;
		assert.deepEqual(report.rendererAfterReopen, []);
		await screenshot("browser-reopened");
		save();
	} finally {
		report.guestEvents = await evaluate("window.__ownedBrowserEvents ?? []");
		report.finalView = workspace(await readView());
		save();
		if (started && terminalTab) {
			await click(
				`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`,
			);
			await until(
				() =>
					evaluate(
						`document.querySelector(${JSON.stringify(selector)})?.dataset.restoreState==='attached'`,
					),
				"original HTTP terminal reattached for cleanup",
			);
			await click(`${selector} .xterm-screen`);
			await key("c", "KeyC", 2);
			await until(
				async () => !(await readProof()).running,
				"owned HTTP fixture stopped by terminal interrupt",
			);
			report.cleanup = await readProof();
			save();
		}
	}
}
