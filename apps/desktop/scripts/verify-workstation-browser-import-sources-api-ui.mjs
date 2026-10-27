import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join,resolve,sep} from "node:path";
import {resolveDirectNamespace} from "../../../packages/cli/src/lib/direct-namespace/resolveDirectNamespace.ts";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";
export async function verifyWorkstationBrowserImportSourcesApiUi(options,{scope,readView,workspace}){
 assert.equal(process.platform,"linux");
 const {until}=agentUiDriver(options),controls=options.controls.forNamespace?.(scope.d.namespaceId)??options.controls;
 const fixture=JSON.parse(readFileSync(join(options.output,"..","import-fixture.json"),"utf8")),profile=resolve(fixture.defaultId),root=resolve(process.env.XDG_CONFIG_HOME,"google-chrome");assert.ok(profile.startsWith(root+sep));
 const hash=path=>createHash("sha256").update(readFileSync(path)).digest("hex"),files=[join(profile,"History"),join(root,"Local State")],sourceHashes=()=>files.map(path=>({path,sha256:hash(path)}));
 const report={source:process.env.GITHUB_SHA,mode:"Actual protected sources query over local or owned SSH backend into the original desktop listing; Linux retains the original no-Keychain empty login list; no import or CLI mutation claim",calls:[]};
 const save=()=>writeFileSync(join(options.output,"browser-import-sources-api.json"),JSON.stringify(report,null,2)+"\n");
 const ready=()=>until(async()=>{const description=(await resolveDirectNamespace(controls.browserNamespaceHome())).description;assert.equal(description.namespaceId,scope.d.namespaceId);assert.equal(description.backendId,scope.d.backendId);return description.capabilities.workstationBrowserImportSourcesV1===true;},"owned login source listing ready");
 const request=async(input,authenticated=true)=>{const result=await controls.browserImportSourcesRequest(input,authenticated);report.calls.push({input,authenticated,...result});save();return result;};
 const uiSources=()=>options.getPage().evaluate("window.directWorkstation.browser.importData.getSources()");
 const selected=async()=>{const view=await readView(),w=workspace(view);return{connectionId:view.snapshot.activeConnectionId,workspaceTab:view.snapshot.targets.find(t=>t.connectionId===scope.d.connectionId)?.activeTabId,workspaceId:w.workspaceId,paneTab:w.activePaneTabId,paneId:w.activePaneId,panes:w.panes.map(p=>({paneId:p.paneId,kind:p.kind,resourceId:p.resourceId,url:p.browser?.url}))};};
 const focus=()=>options.getPage().evaluate("({tag:document.activeElement?.tagName,className:document.activeElement?.className})");
 await ready();const hashes=sourceHashes(),sources=await uiSources();assert.ok(sources.sources.some(row=>row.id===profile&&row.browserName==="Google Chrome"&&row.profileName==="Owned Login Sources 中文"));
 const before=await selected(),focusBefore=await focus();
 const first=await request();assert.equal(first.status,200);assert.deepEqual(first.result,{sources:[]});assert.equal((await request({profileDir:"/owned-but-not-an-input"})).status,400);assert.equal((await request(undefined,false)).status,401);assert.deepEqual((await request()).result,first.result);
 assert.deepEqual(await selected(),before);assert.deepEqual(await focus(),focusBefore);assert.deepEqual(sourceHashes(),hashes);assert.deepEqual(options.getPage().errors,[]);await options.screenshot("browser-import-sources-read-only");
 report.completed={detectedOwnedProfile:sources.sources.find(row=>row.id===profile),loginSources:first.result,sameOriginalLinuxKeychainFilter:true,sourceFilesUnchanged:hashes,selectionAndFocusPreserved:true,invalidInputAndUnauthorizedRejected:true,rendererErrors:options.getPage().errors};save();
 return{report,async afterReopen(){await ready();const before=await selected(),focusBefore=await focus();assert.deepEqual((await request()).result,first.result);assert.ok((await uiSources()).sources.some(row=>row.id===profile));assert.deepEqual(sourceHashes(),hashes);assert.deepEqual(await selected(),before);assert.deepEqual(await focus(),focusBefore);assert.deepEqual(options.getPage().errors,[]);await options.screenshot("browser-import-sources-reopened");report.reopened={sameOriginalLinuxKeychainFilter:true,sourceFilesUnchanged:hashes,selectionAndFocusPreserved:true,rendererErrors:options.getPage().errors};save();}};
}
