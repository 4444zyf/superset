import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { app, BrowserWindow, webContents, session } from 'electron';
import { browserManager } from '/workspace/superset/apps/desktop/src/main/lib/browser/browser-manager';
import { WorkstationBrowserRegistry } from '/workspace/superset/apps/desktop/src/main/lib/ssh-direct/workstation-browser-registry';
import { guardWorkstationWebviews } from '/workspace/superset/apps/desktop/src/main/lib/ssh-direct/workstation-browser-security';

const output = process.argv.at(-1);
assert(output?.startsWith('/workspace/scratch/parity-74/'));
mkdirSync(output, { recursive: true, mode: 0o700 });
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const report: Record<string, unknown> = { kind: 'Native Electron guest boundary integration; no workstation UI or SSH journey claimed', electron: process.versions.electron, sourceTree: '/workspace/superset' };
const windows: BrowserWindow[] = [];
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Owned guest boundary</title><body style="background:#202020;color:white"><h1>Owned guest boundary</h1><p>中文 clipboard and page marker</p></body>');
});
let registry: WorkstationBrowserRegistry | undefined;
let status = 0;
const watchdog = setTimeout(() => { writeFileSync(join(output, 'timeout.txt'), 'Native fixture timed out'); app.exit(1); }, 30000);
async function run() {
try {
  writeFileSync(join(output, 'phase.txt'), 'waiting-ready');
  await app.whenReady();
  writeFileSync(join(output, 'phase.txt'), 'ready');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/owned`;
  for (let i = 0; i < 2; i++) {
    const window = new BrowserWindow({ width: 800, height: 600, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true } });
    windows.push(window);
    guardWorkstationWebviews(window.webContents);
    await window.loadURL(url + '?host=' + i);
  }
  async function createGuest(host: BrowserWindow) {
    const attached = once(host.webContents, 'did-attach-webview');
    await host.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const view=document.createElement('webview');
      view.style.cssText='width:700px;height:350px;display:flex';
      view.setAttribute('partition','persist:superset');
      view.setAttribute('preload','file:///untrusted/preload.js');
      view.setAttribute('webpreferences','nodeIntegration=yes,contextIsolation=no,sandbox=no,webSecurity=no,allowRunningInsecureContent=yes');
      view.src=${JSON.stringify(url + '?guest=1')};
      view.addEventListener('dom-ready',()=>resolve(view.getWebContentsId()),{once:true});
      view.addEventListener('did-fail-load',e=>reject(new Error(e.errorDescription)),{once:true});
      document.body.appendChild(view);
    })`);
    const [, guest] = await attached;
    return guest as Electron.WebContents;
  }
  writeFileSync(join(output, 'phase.txt'), 'creating-guests');
  const a = await createGuest(windows[0]);
  const b = await createGuest(windows[1]);
  writeFileSync(join(output, 'phase.txt'), 'verifying-boundary');
  const descriptor = { connectionId: '58f4aac1-412c-4fca-83c2-4bc9c2293dc4', generation: 1, backendId: 'owned-backend', namespaceId: 'owned-namespace', instanceId: 'owned-instance' };
  const pane = { connectionId: descriptor.connectionId, generation: 1, workspaceId: 'f340a634-2199-4305-86c4-03c46c046e1c', paneId: 'owned-page' };
  const events: unknown[] = [];
  registry = new WorkstationBrowserRegistry({ manager: browserManager, getGuest: id => webContents.fromId(id) ?? undefined, describe: () => descriptor, checkWorkspace: async input => { assert.equal(input.workspaceId, pane.workspaceId); }, send: (owner, event) => events.push({ owner, event }) });
  registry.activateOwner(windows[0].webContents.id);
  await assert.rejects(registry.register(windows[0].webContents.id, { ...pane, webContentsId: b.id }), /belong/);
  await registry.register(windows[0].webContents.id, { ...pane, webContentsId: a.id });
  assert.equal(a.getType(), 'webview');
  assert.equal(a.hostWebContents?.id, windows[0].webContents.id);
  const prefs = a.getLastWebPreferences();
  assert.equal(prefs?.nodeIntegration, false);
  assert.equal(prefs?.contextIsolation, true);
  assert.equal(prefs?.sandbox, true);
  assert.equal(prefs?.webSecurity, true);
  assert.equal(prefs?.allowRunningInsecureContent, false);
  assert.equal(prefs?.preload, undefined);
  assert.equal(a.session, session.fromPartition('persist:superset'));
  report.actualBrowserSessionPath = a.session.storagePath;
  const guestState = await a.executeJavaScript('({node:typeof require, process:typeof process, marker:document.body.innerText})');
  assert.equal(guestState.node, 'undefined');
  assert.equal(guestState.process, 'undefined');
  assert.match(guestState.marker, /中文 clipboard and page marker/);
  const registered = browserManager.listPanes(pane.workspaceId);
  assert.equal(registered.length, 1);
  assert.match(registered[0].paneId, /owned-backend/);
  let initialFileBlocked = false;
  const invalidAttach = new Promise<void>(resolve => windows[0].webContents.once('will-attach-webview', (event, _prefs, params) => { assert.equal(params.src, 'file:///etc/passwd'); initialFileBlocked = event.defaultPrevented; resolve(); }));
  await windows[0].webContents.executeJavaScript("{const v=document.createElement('webview');v.setAttribute('partition','persist:superset');v.src='file:///etc/passwd';document.body.appendChild(v)}");
  await invalidAttach;
  assert.equal(initialFileBlocked, true);
  let otherPartitionBlocked = false;
  const invalidPartition = new Promise<void>(resolve => windows[0].webContents.once('will-attach-webview', (event, _prefs, params) => { assert.equal(params.partition, 'persist:untrusted-other'); otherPartitionBlocked = event.defaultPrevented; resolve(); }));
  await windows[0].webContents.executeJavaScript("{const v=document.createElement('webview');v.setAttribute('partition','persist:untrusted-other');v.src=" + JSON.stringify(url) + ";document.body.appendChild(v)}");
  await invalidPartition;
  assert.equal(otherPartitionBlocked, true);
  report.otherPartitionBlocked = otherPartitionBlocked;
  writeFileSync(join(output, 'owned-guest.png'), (await windows[0].capturePage()).toPNG());
  Object.assign(report, { url, owner: windows[0].webContents.id, otherOwner: windows[1].webContents.id, guestType: a.getType(), guestHost: a.hostWebContents?.id, crossWindowRejected: true, prefs, guestState, registered, initialFileBlocked, events });
  const destroyed = once(a, 'destroyed');
  registry.closeConnection(descriptor.connectionId);
  await destroyed;
  assert.equal(a.isDestroyed(), true);
  assert.equal(b.isDestroyed(), false);
  assert.equal(browserManager.listPanes().length, 0);
  Object.assign(report, { selectedGuestDestroyed: true, otherWindowGuestRetained: true, registeredAfterClose: 0 });
} catch (error) {
  status = 1;
  report.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
} finally {
  try { registry?.dispose(); } catch (error) { report.cleanupError = String(error); status = 1; }
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  clearTimeout(watchdog);
  report.exit = status;
  writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  app.exit(status);
}

}
void run();
