import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";

const agentProgram = String.raw`import os,sys,json,re,hashlib,base64,struct,termios,tty,urllib.request,urllib.parse,uuid
from pathlib import Path
root=Path(sys.argv[2]).resolve()
assert Path.cwd().resolve()==root and os.environ.get('SUPERSET_WORKSPACE_ID')==sys.argv[1]
terminal=os.environ['SUPERSET_TERMINAL_ID'];hook=os.environ['SUPERSET_HOST_AGENT_HOOK_URL'];u=urllib.parse.urlparse(hook)
assert u.scheme=='http' and u.hostname=='127.0.0.1' and u.path=='/trpc/notifications.hook'
marker='OWNED-DESIGN-'+str(uuid.uuid4());launch='owned-'+str(uuid.uuid4());session='owned-'+str(uuid.uuid4())
proof=root/'.superset/owned-design-received.json';state={'marker':marker,'terminalId':terminal,'pid':os.getpid(),'cwd':str(root),'launchId':launch,'sessionId':session,'running':True,'feedbacks':[]}
def save():
 temp=proof.with_suffix('.tmp');temp.write_text(json.dumps(state));temp.replace(proof)
def notify(event):
 body={'json':{'terminalId':terminal,'eventType':event,'launchId':launch,'agent':{'agentId':'claude','sessionId':session}}}
 request=urllib.request.Request(hook,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(request,timeout=5) as response:
  data=json.load(response)['result']['data']['json'];assert data['success'] and not data.get('ignored',False)
def record(prompt,transport,raw=None):
 row={'prompt':prompt,'transport':transport,'files':[]}
 if raw is not None:row['rawBase64']=base64.b64encode(raw).decode()
 for relative in sorted(set(re.findall(r'\.superset/attachments/design-[\w.-]+\.(?:md|png)',prompt))):
  path=(root/relative).resolve();assert path.parent==root/'.superset/attachments';data=path.read_bytes()
  item={'relative':relative,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
  if path.suffix=='.md':item['text']=data.decode()
  else:
   assert data[:8]==b'\x89PNG\r\n\x1a\n';item['width'],item['height']=struct.unpack('>II',data[16:24])
   if len(data)<=65536:item['base64']=base64.b64encode(data).decode()
  row['files'].append(item)
 assert any(item['relative'].endswith('.md') for item in row['files']);state['feedbacks'].append(row);save()
notify('Attached');record(sys.argv[3],'argv')
fd=sys.stdin.fileno();old=termios.tcgetattr(fd)
try:
 tty.setraw(fd);sys.stdout.write('\x1b[?1049h\x1b[?2004l\x1b[2J\x1b[HOWNED DESIGN AGENT\r\nSynthetic TUI, ready for feedback.\r\n');sys.stdout.flush();buffer=b''
 while True:
  chunk=os.read(fd,4096)
  if not chunk or b'\x03' in chunk:break
  buffer+=chunk
  if b'\r' not in buffer:continue
  raw,buffer=buffer.split(b'\r',1);assert raw.startswith(b'\x1b[200~') and raw.endswith(b'\x1b[201~')
  record(raw[6:-6].decode(),'pty',raw);sys.stdout.write('Feedback received.\r\n');sys.stdout.flush()
finally:
 termios.tcsetattr(fd,termios.TCSADRAIN,old);sys.stdout.write('\x1b[?1049l');sys.stdout.flush();notify('Detached');state['running']=False;save()
`;

export async function verifyWorkstationBrowserDesignUi(options, context) {
	const { getPage, click, screenshot, output, controls } = options;
	const { scope, url, marker, readProof, guestRead, key, readView, workspace, terminalTab } = context;
	const { evaluate, until } = agentUiDriver(options);
	const report = {
		api: await evaluate("Boolean(window.directWorkstation.browser?.designMode)"),
		button: await evaluate("Boolean(document.querySelector('[data-workstation-browser-pane] button[aria-label=\"Design\"]'))"),
	};
	const save = () => writeFileSync(join(output, "browser-design-ui.json"), JSON.stringify(report, null, 2) + "\n");
	save();
	await screenshot("browser-design-entry");
	assert.equal(report.api && report.button, true, "original design-mode entry and private service are available");
	assert.equal((await readProof()).marker, marker, "only the owned workspace fixture can configure an agent");
	const rpc = (path, input, type = "query") => evaluate(`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.d.connectionId, generation: scope.d.generation, path, type, input })})`);
	const form = 'textarea[placeholder="Describe the change…"]';
	const button = '[data-workstation-browser-pane] button[aria-label="Design"]';
	const browserTab = workspace(await readView()).activePaneTabId;
	report.browserTab = browserTab;
	const snapshot = () => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(form)}),form=input?.closest('form'),guest=[...document.querySelectorAll('webview')].find(v=>v.style.visibility==='visible'),r=form?.getBoundingClientRect(),g=guest?.getBoundingClientRect();return {pressed:document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed'),comment:input?.value,focused:input===document.activeElement,form:r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null,guest:g?{left:g.left,top:g.top,right:g.right,bottom:g.bottom}:null};})()`);
	const point = async (selector) => evaluate(`(async()=>{const v=[...document.querySelectorAll('webview')].find(v=>v.style.visibility==='visible');const p=await v.executeJavaScript(${JSON.stringify(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:innerWidth,height:innerHeight};})()`)});const r=v.getBoundingClientRect();return {x:r.left+p.x*r.width/p.width,y:r.top+p.y*r.height/p.height};})()`);
	const guestClick = async (selector) => {
		const p = await point(selector);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", { type, ...p, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
	};
	const capture = async (selector = "h1") => {
		await click(button);
		await until(() => evaluate(`document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed')==='true'`), "picker selecting");
		await guestClick(selector);
		await until(() => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(form)});return input&&document.activeElement===input&&input.closest('form').getBoundingClientRect().width>100;})()`), "selected element composer is laid out and focused");
		return snapshot();
	};
	const readReceived = async () => {
		const row = await rpc("filesystem.readFile", { workspaceId: scope.w.workspaceId, absolutePath: `${scope.root}/.superset/owned-design-received.json`, maxBytes: 262144 });
		return JSON.parse(row.kind === "bytes" ? Buffer.from(row.content, "base64").toString() : row.content);
	};
	try {
		report.firstCapture = await capture();
		assert.equal(report.firstCapture.focused, true);
		assert.ok(report.firstCapture.form.left >= report.firstCapture.guest.left && report.firstCapture.form.right <= report.firstCapture.guest.right);
		await screenshot("browser-design-captured");
		await key("Escape", "Escape");
		await until(() => evaluate(`!document.querySelector(${JSON.stringify(form)})&&document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed')==='true'`), "Escape repicks");
		await key("Escape", "Escape");
		await until(() => evaluate(`document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed')==='false'`), "second Escape exits");
		await until(async () => await guestRead("typeof window.__supersetDesignMode==='undefined'"), "guest picker torn down");
		report.escape = await snapshot();

		await click(button);
		await click(`[data-workstation-pane-tabs] [data-tab-id="${terminalTab}"]`);
		await click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
		await until(() => evaluate(`document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed')==='false'`), "pane remount discards picker");
		await until(async () => await guestRead("typeof window.__supersetDesignMode==='undefined'"), "remounted guest has no picker");
		report.remount = await snapshot();

		await capture();
		await click(`[data-workstation-browser-toolbar] button[title="${url}"]`);
		await until(() => evaluate("document.querySelector('input[placeholder=\"Enter URL or search...\"]')===document.activeElement"), "address field is focused");
		await key("a", "KeyA", process.platform === "darwin" ? 4 : 2);
		await getPage().call("Input.insertText", { text: `http://localhost:${(await readProof()).port}/next?design=navigation` });
		await key("Enter", "Enter");
		await until(async () => (await guestRead("document.title")) === "Owned browser next 中文 🙂", "navigation replaces captured document");
		assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(form)}))`), false);
		await click('[data-workstation-browser-toolbar] > div > div:first-child > button:nth-child(1)');
		await until(async () => (await guestRead("location.href"))?.includes("/preview?"), "back to owned page");
		report.navigation = await snapshot();

		await rpc("filesystem.createDirectory", { workspaceId: scope.w.workspaceId, absolutePath: `${scope.root}/.superset`, recursive: true }, "mutation");
		const scriptPath = `${scope.root}/.superset/owned-design-agent-${randomUUID()}.py`;
		await rpc("filesystem.writeFile", { workspaceId: scope.w.workspaceId, absolutePath: scriptPath, content: agentProgram }, "mutation");
		const catalog = await rpc("settings.agentConfigs.catalogWithRevisionV2");
		const configId = randomUUID(), label = `Owned Design Fixture ${randomUUID().slice(0, 6)}`;
		await rpc("settings.agentConfigs.applyCatalogChangeV2", { expectedRevision: catalog.revision, change: { kind: "add", id: configId, config: { label, command: "/usr/bin/python3", args: [scriptPath, scope.w.workspaceId, scope.root], promptTransport: "argv", promptArgs: [], resumeArgs: [], forkArgs: [], env: {}, presetId: "custom" } } }, "mutation");
		report.fixture = { configId, label, scriptPath, syntheticAgentNotVendorAuthentication: true };
		await capture();
		await click('button[aria-label="Choose agent"]');
		await click('input[aria-label="Choose agent"]');
		await getPage().call("Input.insertText", { text: label });
		await until(() => evaluate(`Boolean(document.querySelector('[cmdk-item][data-value="new:${configId}"]'))`), "owned agent config in original picker");
		await click(`[cmdk-item][data-value="new:${configId}"]`);
		await click(form);
		const comment = "把这个标题改成蓝色 🙂";
		await getPage().call("Input.insertText", { text: comment });
		await until(() => evaluate("!document.querySelector('button[aria-label=\"Send to agent\"]')?.disabled"), "feedback ready to launch selected config");
		report.beforeNewSend = await snapshot();
		await screenshot("browser-design-new-agent-feedback");
		await key("Enter", "Enter");
		report.newAgent = await until(async () => {
			try { const p = await readReceived(); return p.running && p.feedbacks.length === 1 ? p : null; } catch { return null; }
		}, "real agent launch consumed original context and screenshot");
		assert.equal(report.newAgent.cwd, scope.root);
		await until(() => evaluate(`Boolean(document.querySelector('[data-terminal-id="${report.newAgent.terminalId}"][data-restore-state="attached"]'))`), "new agent terminal is attached in the workspace");
		const first = report.newAgent.feedbacks[0];
		assert.equal(first.transport, "argv");
		assert.ok(first.prompt.includes(comment) && first.prompt.includes(`http://localhost:${(await readProof()).port}`));
		assert.ok(first.files.some(f => f.relative.endsWith(".md") && f.text.includes(marker) && f.text.includes(comment) && !f.text.includes("superset browser")));
		const firstImage = first.files.find(f => f.relative.endsWith(".png"));
		assert.ok(firstImage?.width > 0 && firstImage?.height > 0);
		if (firstImage.base64) writeFileSync(join(output, "browser-design-selected-element.png"), Buffer.from(firstImage.base64, "base64"));
		const [execution] = await rpc("workspace.restoreResources", { refs: [{ workspaceId: scope.w.workspaceId, resourceId: report.newAgent.terminalId, kind: "terminal" }] });
		assert.equal(execution.state, "live");
		report.agentBefore = await controls.inspectRunExecution({ terminalId: report.newAgent.terminalId, executionId: execution.executionId });
		assert.equal(report.agentBefore.alive, true);
		report.agentExecutionId = execution.executionId;
		await screenshot("browser-design-owned-tui");
		save();

		await click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
		await capture("#next");
		assert.ok((await guestRead("location.href")).includes("/preview?"), "picking a link does not navigate");
		await until(() => evaluate("document.querySelector('button[aria-label=\"Choose agent\"]')?.textContent.includes('claude')||document.querySelector('button[aria-label=\"Choose agent\"]')?.textContent.includes('Owned')"), "existing agent is available");
		await click(form);
		const followup = "仅修改选中的链接，保留其他元素。";
		await getPage().call("Input.insertText", { text: followup });
		await until(() => evaluate("!document.querySelector('button[aria-label=\"Send to agent\"]')?.disabled"), "feedback ready for existing TUI");
		report.beforeExistingSend = await snapshot();
		await screenshot("browser-design-existing-agent-feedback");
		await key("Enter", "Enter");
		report.existingAgent = await until(async () => { const p = await readReceived(); return p.feedbacks.length === 2 ? p : null; }, "existing TUI consumed a paste-framed prompt");
		const second = report.existingAgent.feedbacks[1], raw = Buffer.from(second.rawBase64, "base64");
		assert.equal(second.transport, "pty");
		assert.equal(raw.toString(), `\x1b[200~${second.prompt}\x1b[201~`);
		assert.ok(second.prompt.includes(followup));
		assert.equal(report.existingAgent.pid, report.newAgent.pid);
		report.agentAfter = await controls.inspectRunExecution({ terminalId: report.newAgent.terminalId, executionId: execution.executionId }, report.agentBefore.pid);
		for (const key of ["pid", "executionId", "cwd"]) assert.equal(report.agentAfter[key], report.agentBefore[key]);
		assert.equal((await rpc("terminalAgents.listByWorkspace", { workspaceId: scope.w.workspaceId })).filter(b => b.terminalId === report.newAgent.terminalId && b.endedAt === undefined).length, 1);
		await click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
		await until(() => evaluate(`document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed')==='false'`), "delivered capture exits design mode");
		report.errors = getPage().errors;
		assert.deepEqual(report.errors, []);
		save();
		return report;
	} catch (error) {
		report.error = String(error);
		save();
		await screenshot("browser-design-incomplete");
		throw error;
	}
}

export async function verifyWorkstationBrowserDesignReopened(options, previous, context) {
	const { evaluate, until } = agentUiDriver(options);
	const { scope, key, readView, workspace } = context;
	const browserTab = previous.browserTab;
	const rpc = (path, input) => evaluate(`window.directWorkstation.rpc(${JSON.stringify({ connectionId: scope.d.connectionId, generation: scope.d.generation, path, type: "query", input })})`);
	const row = await rpc("filesystem.readFile", { workspaceId: scope.w.workspaceId, absolutePath: `${scope.root}/.superset/owned-design-received.json`, maxBytes: 262144 });
	const proof = JSON.parse(row.kind === "bytes" ? Buffer.from(row.content, "base64").toString() : row.content);
	assert.equal(proof.feedbacks.length, 2);
	const agent = workspace(await readView()).panes.find(p => p.kind === "terminal" && p.resourceId === previous.newAgent.terminalId);
	assert.ok(agent);
	const after = await options.controls.inspectRunExecution({ terminalId: previous.newAgent.terminalId, executionId: previous.agentExecutionId }, previous.agentBefore.pid);
	for (const key of ["pid", "executionId", "cwd"]) assert.equal(after[key], previous.agentBefore[key]);
	assert.equal(await evaluate("Boolean(document.querySelector('textarea[placeholder=\"Describe the change…\"]'))"), false);
	await options.screenshot("browser-design-reopened");
	await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
	const guestPane = await evaluate(`(()=>{const input=document.querySelector('input[data-pane-title-id="${agent.paneId}"]');const e=input?.closest('[data-pane-id]');return e?.getAttribute('data-pane-id')??null;})()`);
	const terminalSelector = `[data-terminal-id="${previous.newAgent.terminalId}"] .xterm-screen`;
	if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(terminalSelector)}))`)) {
		const view = workspace(await readView()), tab = view.paneTabs?.find(t => JSON.stringify(t.layout).includes(agent.paneId));
		assert.ok(tab);
		await options.click(`[data-workstation-pane-tabs] [data-tab-id="${tab.tabId}"]`);
	}
	await options.click(terminalSelector);
	await key("c", "KeyC", process.platform === "darwin" ? 4 : 2);
	const stopped = await until(async () => {
		const r = await rpc("filesystem.readFile", { workspaceId: scope.w.workspaceId, absolutePath: `${scope.root}/.superset/owned-design-received.json`, maxBytes: 262144 });
		const p = JSON.parse(r.kind === "bytes" ? Buffer.from(r.content, "base64").toString() : r.content); return !p.running ? p : null;
	}, "owned synthetic TUI stopped by actual Ctrl+C");
	await options.click(`[data-workstation-pane-tabs] [data-tab-id="${browserTab}"]`);
	const report = { agent: after, feedbacks: proof.feedbacks.length, stoppedByActualCtrlC: !stopped.running, guestPane, errors: options.getPage().errors };
	assert.deepEqual(report.errors, []);
	writeFileSync(join(options.output, "browser-design-reopened.json"), JSON.stringify(report, null, 2) + "\n");
	return report;
}
