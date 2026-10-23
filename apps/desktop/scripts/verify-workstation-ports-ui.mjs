import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

export async function verifyWorkstationPortsUi(options) {
	const {
		getPage,
		click,
		screenshot,
		output,
		controls,
		closeReopen,
		observePortBrowserCalls,
	} = options;
	const { evaluate, until } = agentUiDriver(options);
	const browserLog = process.env.OWNED_PORT_BROWSER_LOG;
	assert.ok(
		browserLog,
		"This journey requires its owned real browser launcher",
	);
	const launches = () => {
		try {
			return readFileSync(browserLog, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((s) => JSON.parse(s));
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const {snapshot}=await window.directWorkstation.getWorkspaceView();const t=snapshot.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);const p=(await window.directWorkstation.list()).find(p=>p.id===d.connectionId);return {connectionId:d.connectionId,backendId:d.backendId,namespaceId:d.namespaceId,localDevice:p?.kind==='local',workspaceId:w.workspaceId,terminals:w.panes.filter(p=>p.kind==='terminal').map(p=>p.resourceId)};})()`,
	);
	const query = (path, input) =>
		evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;if(d.connectionId!==${JSON.stringify(scope.connectionId)}||d.backendId!==${JSON.stringify(scope.backendId)}||d.namespaceId!==${JSON.stringify(scope.namespaceId)})throw Error('Scope changed');return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:${JSON.stringify(path)},type:'query',input:${JSON.stringify(input)}});})()`,
		);
	const workspace = await query("workspace.get", { id: scope.workspaceId });
	const originals = await Promise.all(
		scope.terminals.map(async (id) => {
			const row = await controls.inspectPresetTerminal(id);
			assert.equal(row.alive, true);
			return {
				id: row.id,
				pid: row.pid,
				executionId: row.executionId,
				cwd: row.cwd,
			};
		}),
	);
	await click("text:New terminal");
	const terminal = await until(
		() =>
			evaluate(
				`[...document.querySelectorAll('[data-terminal-id]')].map(e=>({id:e.dataset.terminalId,state:e.dataset.restoreState})).find(e=>e.state==='attached'&&!${JSON.stringify(scope.terminals)}.includes(e.id))`,
			),
		"HTTP fixture terminal attached",
	);
	const selector = `[data-terminal-id="${terminal.id}"]`;
	const marker = `OWNED-PORT-${randomUUID()}`;
	const urlLinks = process.argv.includes("--terminal-url-links");
	const script = [
		"import http.server,json,os,signal",
		"def stop(*args): raise KeyboardInterrupt",
		"signal.signal(signal.SIGTERM,stop)",
		"from pathlib import Path",
		`state={"marker":${JSON.stringify(marker)},"requests":[],"pid":os.getpid(),"running":True}`,
		'def save():\n temp=Path("port-proof.tmp");temp.write_text(json.dumps(state)+"\\n");temp.replace("port-proof.json")',
		"class Handler(http.server.BaseHTTPRequestHandler):",
		" def do_GET(self):",
		'  state["requests"].append({"path":self.path,"userAgent":self.headers.get("User-Agent")});save()',
		'  body=state["marker"].encode();self.send_response(200);self.send_header("Content-Type","text/plain");self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)',
		" def log_message(self,*args): pass",
		'server=http.server.HTTPServer(("127.0.0.1",0),Handler)',
		'state["port"]=server.server_port;state["url"]="http://localhost:"+str(server.server_port)+"/preview/sub?value=%E4%B8%AD%20hello#fragment";save()',
		urlLinks
			? 'print("\\x1b[2J\\x1b[H"+state["url"]+"\\n\\x1b]8;;"+state["url"]+"\\x07OPEN WEB LINK\\x1b]8;;\\x07",flush=True)'
			: 'print("OWNED HTTP SERVER",server.server_port,flush=True)',
		"try: server.serve_forever()",
		"except KeyboardInterrupt: pass",
		'finally: server.server_close();state["running"]=False;save()',
	].join("\n");
	const command = `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(script).toString("base64")}"))'`;
	const key = async (key, code, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await getPage().call("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				modifiers,
				windowsVirtualKeyCode:
					key === "Enter" ? 13 : key === "Escape" ? 27 : 67,
			});
	};
	const read = async () => {
		const r = await query("filesystem.readFile", {
			workspaceId: scope.workspaceId,
			absolutePath: `${workspace.worktreePath}/port-proof.json`,
			maxBytes: 16384,
		});
		return JSON.parse(
			r.kind === "bytes"
				? Buffer.from(r.content, "base64").toString()
				: r.content,
		);
	};
	await getPage().call("Page.bringToFront");
	await click(`${selector} .xterm-screen`);
	await getPage().call("Input.insertText", { text: command });
	await key("Enter", "Enter");
	const initial = await until(async () => {
		try {
			const proof = await read();
			return proof.marker === marker ? proof : null;
		} catch {
			return null;
		}
	}, "owned HTTP server listening");
	const execution = await controls.inspectPresetTerminal(terminal.id);
	const input = 'input[aria-label="Port"]';
	const submit = async () => {
		await click(input);
		await getPage().call("Input.insertText", { text: String(initial.port) });
		await click("text:Open port");
	};
	const report = {
		scope,
		originals,
		terminal,
		execution,
		initial,
		beforeLaunches: launches(),
		beforeMainCalls: await observePortBrowserCalls(),
		sourceRevision: process.env.GITHUB_SHA,
	};
	let paused;
	let cleanupError;
	try {
		report.detectedPort = await until(async () => {
			const ports = await controls.inspectWorkspacePorts(scope.workspaceId);
			writeFileSync(
				join(output, "port-readiness.json"),
				`${JSON.stringify({ scope, server: initial, ports }, null, 2)}\n`,
			);
			return ports.find(
				(p) => p.port === initial.port && p.terminalId === terminal.id,
			);
		}, "scanner attributes the real server port to its owning terminal");
		if (urlLinks) {
			const { verifyWorkstationTerminalUrlLinksUi } = await import(
				"./verify-workstation-terminal-url-links-ui.mjs"
			);
			await verifyWorkstationTerminalUrlLinksUi(options, {
				scope,
				initial,
				terminal,
				execution,
				originals,
				selector,
				read,
				launches,
				report,
			});
		} else if (process.argv.includes("--port-discovery")) {
			const { verifyWorkstationPortDiscoveryUi } = await import(
				"./verify-workstation-port-discovery-ui.mjs"
			);
			await verifyWorkstationPortDiscoveryUi(options, {
				scope,
				initial,
				terminal,
				execution,
				originals,
				selector,
				read,
				launches,
				report,
			});
			if (process.argv.includes("--port-kill")) {
				const { verifyWorkstationPortKillUi } = await import(
					"./verify-workstation-port-kill-ui.mjs"
				);
				await verifyWorkstationPortKillUi(options, {
					initial,
					workspace,
					terminal,
					execution,
					originals,
					selector,
					read,
					report,
				});
			}
		} else {
			await click("text:Port");
			await screenshot("port-before-open");
			await submit();
			const url = await until(
				() =>
					evaluate(
						`document.querySelector('[role=menu] code.text-xs')?.textContent?.startsWith('http://127.0.0.1:')?document.querySelector('[role=menu] code.text-xs').textContent:null`,
					),
				"forward address displayed",
			);
			assert.equal(new URL(url).hostname, "127.0.0.1");
			report.forwardUrl = url;
			report.firstBrowser = await until(async () => {
				const proof = await read();
				return proof.requests.some((r) => r.userAgent?.includes("Chrome/"))
					? proof
					: null;
			}, "real browser loaded remote HTTP server");
			report.firstLaunches = launches();
			report.firstMainCalls = await observePortBrowserCalls();
			assert.equal(
				report.firstMainCalls.length,
				report.beforeMainCalls.length + 1,
			);
			assert.equal(
				report.firstLaunches.length,
				report.beforeLaunches.length + 1,
			);
			assert.equal(
				new URL(report.firstLaunches.at(-1).url).href,
				new URL(url).href,
			);
			await getPage().call("Page.bringToFront");
			await screenshot("port-forward-open");
			const close = await evaluate(
				`(()=>{const e=document.querySelector('[role=menu] code.text-xs')?.parentElement?.querySelector('button');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
			);
			assert.ok(close);
			for (const type of ["mousePressed", "mouseReleased"])
				await getPage().call("Input.dispatchMouseEvent", {
					type,
					...close,
					button: "left",
					clickCount: 1,
				});
			await until(
				() => evaluate(`!document.querySelector('[role=menu] code.text-xs')`),
				"forward closed",
			);
			await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
			assert.equal(
				(await read()).running,
				true,
				"closing the forward does not stop the remote server",
			);
			await key("Escape", "Escape");
			await closeReopen();
			await until(
				() =>
					evaluate(
						`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
					),
				"same server terminal after normal close/reopen",
			);
			const retained = await controls.inspectPresetTerminal(terminal.id);
			assert.equal(retained.pid, execution.pid);
			assert.equal(retained.executionId, execution.executionId);
			report.retained = retained;
			await click("text:Port");
			await click(input);
			await getPage().call("Input.insertText", { text: String(initial.port) });
			report.beforeStaleLaunches = launches();
			report.beforeStaleMainCalls = await observePortBrowserCalls();
			paused = controls.pauseOwnedBackend();
			report.pausedOwnedBackendPid = paused.pid;
			await click("text:Open port");
			await until(
				() =>
					evaluate(
						`document.querySelector('input[aria-label="Port"]')?.disabled===true`,
					),
				"port preparation pending",
			);
			await key("Escape", "Escape");
			await until(
				() => evaluate(`!document.querySelector("[role=menu]")`),
				"port popover closed while preparing",
			);
			await click(".ws-window-toolbar:first-child button:first-child");
			await until(
				() => evaluate(`!document.querySelector('.ws-workspace-window')`),
				"navigated away while preparing",
			);
			await screenshot("port-left-workspace-while-pending");
			paused.resume();
			paused = undefined;
			await until(
				() =>
					evaluate(
						`Boolean([...document.querySelectorAll('.ws-heading-actions button')].find(b=>b.textContent.trim()==='New session'&&!b.disabled))`,
					),
				"old request settled after leaving workspace",
			);
			report.afterStaleProof = await read();
			for (const original of originals) {
				const row = await controls.inspectPresetTerminal(original.id);
				assert.deepEqual(
					{
						id: row.id,
						pid: row.pid,
						executionId: row.executionId,
						cwd: row.cwd,
					},
					original,
				);
			}
			report.afterStaleLaunches = launches();
			report.afterStaleMainCalls = await observePortBrowserCalls();
			report.errors = getPage().errors;
			await screenshot("port-stale-request-settled");
			assert.deepEqual(
				report.afterStaleMainCalls,
				report.beforeStaleMainCalls,
				"a stale port request must not dispatch a browser",
			);
			assert.deepEqual(getPage().errors, []);
		}
	} finally {
		paused?.resume();
		try {
			await getPage().call("Page.bringToFront");
			await key("Escape", "Escape");
			await until(
				() => evaluate(`!document.querySelector('[role=menu]')`),
				"port menu closed before owned cleanup",
			);
			if (
				!(await evaluate(
					`Boolean(document.querySelector('.ws-workspace-window'))`,
				))
			)
				await click(
					`button.ws-workspace-card[aria-label=${JSON.stringify(workspace.name)}]`,
				);
			await until(
				() =>
					evaluate(
						`Boolean(document.querySelector(${JSON.stringify(selector)}+'[data-restore-state="attached"]'))`,
					),
				"owned server terminal available for cleanup",
			);
			await click(`${selector} .xterm-screen`);
			await key("c", "KeyC", 2);
			report.stoppedProof = await until(async () => {
				const proof = await read();
				return proof.running === false ? proof : null;
			}, "owned HTTP server stopped by terminal interrupt");
			if (report.discoveryFinished) {
				await click("text:Port");
				report.portsAfterStop = await until(
					() =>
						evaluate(
							`(()=>{const root=document.querySelector('[data-workspace-ports]');if(!root || root.querySelector('[role=alert]') || root.innerText.includes('Loading...') || root.querySelector('button')?.getAttribute('aria-busy')==='true' || root.querySelector('[data-port="${initial.port}"]'))return null;return {text:root.innerText,ports:[...root.querySelectorAll('[data-port]')].map(e=>Number(e.dataset.port))};})()`,
						),
					"stopped port removed by the settled discovery refresh",
				);
				assert.ok(!report.portsAfterStop.ports.includes(initial.port));
				await screenshot("ports-discovery-after-stop");
			}
		} catch (error) {
			report.cleanupError = String(error);
			cleanupError = error;
		} finally {
			writeFileSync(
				join(output, "ports-ui.json"),
				`${JSON.stringify(report, null, 2)}\n`,
			);
		}
	}
	if (cleanupError) throw cleanupError;
}
