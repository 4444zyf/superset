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
	if (process.argv.includes("--browser-preferences"))
		assert.equal(
			await evaluate("Boolean(window.directWorkstation.browser?.preferences)"),
			true,
			"browser preference API is available",
		);
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
	const downloadsFixture = process.argv.includes("--browser-downloads")
		? (
				await import("./verify-workstation-browser-download-server.mjs")
			).browserDownloadServerFixture()
		: null;
	const script = [
		"import http.server,json,os,signal",
		"from pathlib import Path",
		`state={"marker":${JSON.stringify(marker)},"requests":[],"running":True,"pid":os.getpid()}`,
		...(downloadsFixture?.setup ?? []),
		downloadsFixture?.save ??
			"def save(): temp=Path('browser-proof.tmp');temp.write_text(json.dumps(state));temp.replace('browser-proof.json')",
		"class Handler(http.server.BaseHTTPRequestHandler):",
		" def do_GET(self):",
		"  state['requests'].append(self.path);save()",
		...(downloadsFixture?.handler ?? []),
		`  title='Owned browser '+('next' if self.path.startswith('/next') else 'home')+' 中文 🙂'`,
		`  body=('<!doctype html><meta charset="utf-8"><title>'+title+'</title><h1>'+state['marker']+'</h1><a id="next" href="/next?value=%E4%B8%AD%20hello#section">Next page</a><br><a id="popup" target="_blank" href="/popup">Open second pane</a><p>needle needle needle</p>').encode()`,
		`  body=body.replace(b'<title>',b'<link rel="icon" href="/icon.svg"><title>')`,
		...(downloadsFixture ? [downloadsFixture.body] : []),
		...(process.argv.includes("--browser-read-cli") ? ["  body=body+b'<script>console.warn(document.querySelector(\"h1\").textContent)</script>'"] : []),
		...(process.argv.includes("--browser-screenshots")
			? [
					`  body=body+b'<button id="capture-color" onclick="document.body.style.backgroundColor=String.fromCharCode(35,50,56,53,97,56,50)">Change capture color</button>'`,
				]
			: []),
		process.argv.includes("--browser-device-tools")
			? "  body=body.replace(b'<meta charset=',b'<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta charset=')"
			: "  pass",
		`  content_type='text/html; charset=utf-8'`,
		`  if self.path.startswith('/icon.svg'): body=('<svg xmlns="http://www.w3.org/2000/svg" data-owned="'+state['marker']+'" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>').encode();content_type='image/svg+xml'`,
		process.argv.includes("--browser-clear-data")
			? "  cache_control='public, max-age=3600' if self.path.startswith('/owned-cache?') else 'no-store'"
			: "  cache_control='no-store'",
		"  self.send_response(200);self.send_header('Content-Type',content_type);self.send_header('Cache-Control',cache_control);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)",
		" def log_message(self,*args): pass",
		downloadsFixture?.server ??
			"server=http.server.HTTPServer(('127.0.0.1',0),Handler)",
		"state['port']=server.server_port;save()",
		process.argv.includes("--browser-preferences")
			? 'print("\\x1b[2J\\x1b[Hhttp://localhost:"+str(server.server_port)+"/policy?value=%E4%B8%AD%20hello#fragment",flush=True)'
			: "pass",

		"try: server.serve_forever()",
		"except KeyboardInterrupt: pass",
		downloadsFixture?.finalize ??
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
					key === "Enter"
						? 13
						: key === "Escape"
							? 27
							: key.toUpperCase().charCodeAt(0),
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
	const observeGuest = () =>
		evaluate(
			`(()=>{window.__ownedBrowserEvents??=[];window.__ownedBrowserConsole??=[];const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible');v.addEventListener('console-message',event=>{window.__ownedBrowserConsole.push({level:event.level,message:event.message?.slice(0,4096)});if(window.__ownedBrowserConsole.length>32)window.__ownedBrowserConsole.shift();});for(const type of ['dom-ready','did-navigate','did-navigate-in-page','page-title-updated','page-favicon-updated','did-stop-loading'])v.addEventListener(type,event=>{window.__ownedBrowserEvents.push({type,title:event.title,url:event.url,favicons:event.favicons});if(window.__ownedBrowserEvents.length>64)window.__ownedBrowserEvents.shift();});return true;})()`,
		);
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
	const readDisplayedIcon = () =>
		evaluate(
			`(()=>{const image=document.querySelector('[data-workstation-browser-toolbar] img');return image?.src.startsWith('data:image/')&&image.complete&&image.naturalWidth===16&&image.naturalHeight===16?{src:image.src,width:image.naturalWidth,height:image.naturalHeight}:null;})()`,
		);
	let started = false,
		terminalTab,
		browserReadCli,
		navigationApi, navigationCli, evaluationApi, evaluationCli, openApi, openCli, reloadApi;
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
		report.detectedPort = await until(async () => {
			const ports = await evaluate(
				`window.directWorkstation.listPorts(${JSON.stringify(scope.d)},${JSON.stringify(scope.w.workspaceId)})`,
			);
			return ports.find(
				(row) => row.port === proof.port && row.terminalId === terminal.id,
			);
		}, "original scanner attributes the HTTP port to its owning workspace and terminal");

		if (process.argv.includes("--browser-preferences")) {
			const { verifyWorkstationBrowserPreferencesUi } = await import(
				"./verify-workstation-browser-preferences-ui.mjs"
			);
			await verifyWorkstationBrowserPreferencesUi(options, {
				scope,
				terminal,
				selector,
				proof,
				marker,
				terminalTab,
				readView,
				workspace,
				readProof,
				guestRead,
				key,
			});
			return;
		}

		if (process.argv.includes("--browser-import-banner")) {
			const { prepareBrowserImportBannerFixture } = await import(
				"./verify-workstation-browser-import-banner-ui.mjs"
			);
			prepareBrowserImportBannerFixture(
				options,
				`http://localhost:${proof.port}/preview?first=%E4%B8%AD#initial`,
			);
		}

		await click("[data-workstation-new-browser]");
		await until(
			() =>
				evaluate(
					"Boolean(document.querySelector('[data-workstation-browser-pane]'))",
				),
			"browser page mounted",
		);
		await observeGuest();
		const url = `http://localhost:${proof.port}/preview?first=%E4%B8%AD#initial`;
		await click("text:Enter URL or search...");
		await click('input[placeholder="Enter URL or search..."]');
		await getPage().call("Input.insertText", { text: url });
		await key("Enter", "Enter");
		const loaded = await until(async () => {
			const value = await guestRead(
				"({body:document.body.innerText,title:document.title,url:location.href,node:typeof require,process:typeof process,head:document.head.innerHTML})",
			);
			return value?.body.includes(marker) ? value : null;
		}, "owned page rendered inside Electron guest");
		assert.equal(loaded.node, "undefined");
		assert.equal(loaded.process, "undefined");
		report.loaded = loaded;
		if (process.argv.includes("--browser-read-cli")) {
			const { verifyWorkstationBrowserReadCliUi } = await import("./verify-workstation-browser-read-cli-ui.mjs");
			browserReadCli = await verifyWorkstationBrowserReadCliUi(options, { scope, url, marker, readView, workspace, terminalTab });
		}
		if (process.argv.includes("--browser-icon-display")) {
			report.displayedIcon = await until(
				readDisplayedIcon,
				"declared favicon renders through a bounded data URL under the original CSP",
			);
			assert.ok(
				Buffer.from(report.displayedIcon.src.split(",")[1], "base64")
					.toString("utf8")
					.includes(marker),
				"displayed icon bytes came from this owned server",
			);
			save();
		}
        if (process.argv.includes("--browser-navigation-cli")) {
            const {verifyWorkstationBrowserNavigationCliUi} = await import("./verify-workstation-browser-navigation-cli-ui.mjs");
            navigationCli = await verifyWorkstationBrowserNavigationCliUi(options, {scope,url,marker,readProof,guestRead,readView,workspace,terminalTab});
            report.navigationCli = navigationCli.report;
            save();
        }
        if(process.argv.includes("--browser-evaluation-cli")) {
            const {verifyWorkstationBrowserEvaluationCliUi}=await import("./verify-workstation-browser-evaluation-cli-ui.mjs");
            evaluationCli=await verifyWorkstationBrowserEvaluationCliUi(options,{scope,guestRead,readView,workspace,terminalTab});
            report.evaluationCli=evaluationCli.report;save();
        }
        if(process.argv.includes("--browser-evaluation-api")) {
            const {verifyWorkstationBrowserEvaluationApiUi}=await import("./verify-workstation-browser-evaluation-api-ui.mjs");
            evaluationApi=await verifyWorkstationBrowserEvaluationApiUi(options,{scope,guestRead,readView,workspace,terminalTab});
            report.evaluationApi=evaluationApi.report;save();
        }
		if (process.argv.includes("--browser-navigation-api")) {
			const {verifyWorkstationBrowserNavigationApiUi} = await import("./verify-workstation-browser-navigation-api-ui.mjs");
			navigationApi = await verifyWorkstationBrowserNavigationApiUi(options, {scope, url, marker, readProof, guestRead, readView, workspace, terminalTab});
			report.navigationApi = navigationApi.report;
			save();
		}

		if (process.argv.includes("--browser-design")) {
			const { verifyWorkstationBrowserDesignUi } = await import("./verify-workstation-browser-design-ui.mjs");
			report.design = await verifyWorkstationBrowserDesignUi(options, {scope, url, marker, readProof, guestRead, key, readView, workspace, terminalTab});
			save();
		}
		if (process.argv.includes("--browser-tools")) {
			const { verifyWorkstationBrowserToolsUi } = await import(
				"./verify-workstation-browser-tools-ui.mjs"
			);
			report.tools = await verifyWorkstationBrowserToolsUi(options, {
				url,
				proof,
				marker,
				readProof,
				guestRead,
				key,
			});
			save();
		}

		if (process.argv.includes("--browser-device-tools")) {
			const { verifyWorkstationBrowserDeviceUi } = await import(
				"./verify-workstation-browser-device-ui.mjs"
			);
			report.devices = await verifyWorkstationBrowserDeviceUi(options, {
				scope,
				url,
				proof,
				marker,
				readProof,
				guestRead,
				key,
				terminalTab,
				terminal,
				selector,
				readView,
				workspace,
			});
			save();
		}

		if (process.argv.includes("--browser-clear-data")) {
			const { verifyWorkstationBrowserClearUi } = await import(
				"./verify-workstation-browser-clear-ui.mjs"
			);
			report.clearData = await verifyWorkstationBrowserClearUi(options, {
				url,
				marker,
				guestRead,
				readProof,
			});
			save();
		}

		if (process.argv.includes("--browser-sites")) {
			const { verifyWorkstationBrowserSitesUi } = await import(
				"./verify-workstation-browser-sites-ui.mjs"
			);
			report.sites = await verifyWorkstationBrowserSitesUi(options, {
				guestRead,
				key,
			});
			save();
		}

		if (process.argv.includes("--browser-import-banner")) {
			const { verifyWorkstationBrowserImportBannerUi } = await import(
				"./verify-workstation-browser-import-banner-ui.mjs"
			);
			report.importBanner =
				await verifyWorkstationBrowserImportBannerUi(options);
			save();
		}

		if (process.argv.includes("--browser-import-settings")) {
			const { verifyWorkstationBrowserImportSettingsUi } = await import(
				"./verify-workstation-browser-import-settings-ui.mjs"
			);
			report.importSettings = await verifyWorkstationBrowserImportSettingsUi(
				options,
				{ url },
			);
			save();
		}

		if (process.argv.includes("--browser-import")) {
			const { verifyWorkstationBrowserImportUi } = await import(
				"./verify-workstation-browser-import-ui.mjs"
			);
			report.importData = await verifyWorkstationBrowserImportUi(options, {
				url,
				marker,
				guestRead,
				key,
				readProof,
			});
			save();
		}
		if (process.argv.includes("--browser-screenshots")) {
			const { verifyWorkstationBrowserScreenshotsUi } = await import(
				"./verify-workstation-browser-screenshots-ui.mjs"
			);
			report.screenshots = await verifyWorkstationBrowserScreenshotsUi(
				options,
				{ url, marker, guestRead, key, readProof },
			);
			save();
		}
		if (process.argv.includes("--browser-downloads")) {
			const { verifyWorkstationBrowserDownloadsUi } = await import(
				"./verify-workstation-browser-downloads-ui.mjs"
			);
			report.downloads = await verifyWorkstationBrowserDownloadsUi(options, {
				url,
				marker,
				guestRead,
				key,
				readProof,
				readView,
				workspace,
				observeGuest,
			});
			save();
		}
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
		await until(
			async () =>
				workspace(await readView()).panes.some(
					(p) =>
						p.kind === "browser" &&
						p.browser.faviconUrl === `http://localhost:${proof.port}/icon.svg`,
				),
			"canonical favicon metadata persisted",
		);

		if (process.argv.includes("--browser-history-dialog")) {
			const { verifyWorkstationBrowserHistoryUi } = await import(
				"./verify-workstation-browser-history-ui.mjs"
			);
			report.historyDialog = await verifyWorkstationBrowserHistoryUi(options, {
				url,
				proof,
				marker,
				guestRead,
				key,
				readProof,
			});
			save();
		}
		const browserBeforePopup = workspace(await readView())
			.panes.filter((p) => p.kind === "browser")
			.map((p) => p.paneId);
		const popupPoint = await evaluate(
			`(async()=>{const v=[...document.querySelectorAll('webview')].find(e=>e.style.visibility==='visible');const inner=await v.executeJavaScript("(()=>{const r=document.querySelector('#popup').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");const r=v.getBoundingClientRect();return {x:r.x+inner.x,y:r.y+inner.y};})()`,
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...popupPoint,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		const popup = await until(
			async () =>
				workspace(await readView()).panes.find(
					(p) => p.kind === "browser" && !browserBeforePopup.includes(p.paneId),
				),
			"registered window.open creates a scoped browser split",
		);
		await until(
			() =>
				evaluate(
					`(async()=>{const v=[...document.querySelectorAll('webview')].find(e=>{try{return new URL(e.getURL()).pathname==='/popup';}catch{return false;}});if(!v)return false;try{return (await v.executeJavaScript('document.title'))==='Owned browser home 中文 🙂';}catch{return false;}})()`,
				),
			"new browser split renders its real page",
		);
		report.popup = { paneId: popup.paneId, view: workspace(await readView()) };
		await screenshot("browser-window-open-split");
		const closePopup = await evaluate(
			`(()=>{const input=document.querySelector('input[data-pane-title-id="${popup.paneId}"]');const b=input?.parentElement.parentElement.querySelector('button[aria-label="Close pane"]');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		assert.ok(closePopup);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				...closePopup,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
			});
		await until(
			async () =>
				!workspace(await readView()).panes.some(
					(p) => p.paneId === popup.paneId,
				),
			"closing the selected browser split removes only that page",
		);
		await until(
			() => evaluate("document.querySelectorAll('webview').length===1"),
			"selected guest destroyed while original browser remains",
		);
		report.beforeReopen = workspace(await readView());
		report.history = await evaluate(
			"window.directWorkstation.browser.history.getAll()",
		);
		assert.ok(
			report.history.some(
				(row) =>
					row.url ===
						`http://localhost:${proof.port}/next?value=%E4%B8%AD%20hello#section` &&
					row.faviconUrl === `http://localhost:${proof.port}/icon.svg`,
			),
		);
		report.guestEventsBeforeReopen = await evaluate(
			"window.__ownedBrowserEvents ?? []",
		);
		report.rendererBeforeReopen = getPage().errors;
		assert.deepEqual(report.rendererBeforeReopen, []);
		save();
        if(process.argv.includes("--browser-open-api")) {
            const {verifyWorkstationBrowserOpenApiUi}=await import("./verify-workstation-browser-open-api-ui.mjs");
            openApi=await verifyWorkstationBrowserOpenApiUi(options,{scope,url,readProof,readView,workspace,terminalTab});
            report.openApi=openApi.report;save();
        }
        if(process.argv.includes("--browser-open-cli")) {
            const {verifyWorkstationBrowserOpenCliUi}=await import("./verify-workstation-browser-open-cli-ui.mjs");
            openCli=await verifyWorkstationBrowserOpenCliUi(options,{scope,url,readProof,readView,workspace,terminalTab});
            report.openCli=openCli.report;save();
        }
        if(process.argv.includes("--browser-reload-api")) {
            const {verifyWorkstationBrowserReloadApiUi}=await import("./verify-workstation-browser-reload-api-ui.mjs");
            reloadApi=await verifyWorkstationBrowserReloadApiUi(options,{scope,readProof,guestRead,readView,workspace,terminalTab});
            report.reloadApi=reloadApi.report;save();
        }
		await closeReopen();
		await until(
			async () =>
				(await guestRead("document.title")) === "Owned browser next 中文 🙂",
			"saved browser page after normal reopen",
		);
		if (process.argv.includes("--browser-icon-display")) {
			report.reopenedIcon = await until(
				readDisplayedIcon,
				"the reopened registered guest renders its icon without a stale session result",
			);
			assert.ok(
				Buffer.from(report.reopenedIcon.src.split(",")[1], "base64")
					.toString("utf8")
					.includes(marker),
				"reopened icon bytes came from this owned server",
			);
		}
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
		if (process.argv.includes("--browser-design")) {
			const { verifyWorkstationBrowserDesignReopened } = await import("./verify-workstation-browser-design-ui.mjs");
			report.designReopened = await verifyWorkstationBrowserDesignReopened(options, report.design, {scope, key, readView, workspace});
			save();
		}
		if (process.argv.includes("--browser-history-dialog")) {
			const { verifyWorkstationBrowserHistoryReopened } = await import(
				"./verify-workstation-browser-history-ui.mjs"
			);
			report.historyReopened = await verifyWorkstationBrowserHistoryReopened(
				options,
				report.historyDialog,
			);
			save();
		}
		if (process.argv.includes("--browser-downloads")) {
			const { verifyWorkstationBrowserDownloadsReopened } = await import(
				"./verify-workstation-browser-downloads-ui.mjs"
			);
			report.downloadsReopened =
				await verifyWorkstationBrowserDownloadsReopened(
					options,
					report.downloads,
				);
			save();
		}

		if (process.argv.includes("--browser-screenshots")) {
			const { verifyWorkstationBrowserScreenshotsReopened } = await import(
				"./verify-workstation-browser-screenshots-ui.mjs"
			);
			report.screenshotsReopened =
				await verifyWorkstationBrowserScreenshotsReopened(
					options,
					report.screenshots,
				);
			save();
		}

		if (process.argv.includes("--browser-sites")) {
			const { verifyWorkstationBrowserSitesReopened } = await import(
				"./verify-workstation-browser-sites-ui.mjs"
			);
			report.sitesReopened = await verifyWorkstationBrowserSitesReopened(
				options,
				report.sites,
			);
			save();
		}

		if (process.argv.includes("--browser-import-banner")) {
			const { verifyWorkstationBrowserImportBannerReopened } = await import(
				"./verify-workstation-browser-import-banner-ui.mjs"
			);
			report.importBannerReopened =
				await verifyWorkstationBrowserImportBannerReopened(
					options,
					report.importBanner,
				);
			save();
		}

		if (process.argv.includes("--browser-import-settings")) {
			const { verifyWorkstationBrowserImportReopened } = await import(
				"./verify-workstation-browser-import-ui.mjs"
			);
			report.importSettingsReopened =
				await verifyWorkstationBrowserImportReopened(
					options,
					report.importSettings,
				);
			save();
		}

		if (process.argv.includes("--browser-import")) {
			const { verifyWorkstationBrowserImportReopened } = await import(
				"./verify-workstation-browser-import-ui.mjs"
			);
			report.importReopened = await verifyWorkstationBrowserImportReopened(
				options,
				report.importData,
			);
			save();
		}
		if (browserReadCli) await browserReadCli.afterReopen(`http://localhost:${proof.port}/next?value=%E4%B8%AD%20hello#section`);
		if (navigationApi) await navigationApi.afterReopen();
        if (navigationCli) await navigationCli.afterReopen();
        if(evaluationApi)await evaluationApi.afterReopen();
        if(evaluationCli)await evaluationCli.afterReopen();
        if(openApi)await openApi.afterReopen();
        if(openCli)await openCli.afterReopen();
        if(reloadApi)await reloadApi.afterReopen();
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
