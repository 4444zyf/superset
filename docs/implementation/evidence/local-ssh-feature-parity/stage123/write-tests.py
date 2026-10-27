from pathlib import Path
p=Path('/workspace/superset/packages/cli/src/lib/direct-namespace/browser-import-login.test.ts')
p.write_text('''import {afterEach,expect,test} from "bun:test";
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {createServer,type Server} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseArgv,camelToKebab} from "@superset/cli-framework";
import {directBackendSocketPath} from "@superset/shared/direct-backend-socket";
import SuperJSON from "superjson";
import importLogin from "../../commands/browser/import-login/command";
import {createUnavailableApiClient} from "../api-client";
import {resolveDirectNamespace,resolveBrowserNavigationNamespace,resolveBrowserEvaluationNamespace,resolveBrowserOpenNamespace,resolveBrowserImportNamespace} from "./resolveDirectNamespace";
const roots:string[]=[],servers:Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0))await new Promise<void>(r=>s.close(()=>r()));for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
const chrome={id:"/Desktop/Mac 中文/Chrome/Default",browserKey:"chrome",browserName:"Google Chrome",profileName:"Main 中文",future:{retained:true}};
const opera={...chrome,id:"/Desktop/Opera/Default",browserKey:"opera",browserName:"Opera",profileName:"Main"};
async function fixture(){
 const homeDir=mkdtempSync(join(tmpdir(),"remix-cli-login-"));roots.push(homeDir);
 for(const n of ["state","credentials"])mkdirSync(join(homeDir,n),{mode:0o700});
 const config={backendId:crypto.randomUUID(),namespaceId:crypto.randomUUID(),homeDir,secretFile:join(homeDir,"credentials/host-secret"),migrationsFolder:join(homeDir,"migrations"),allowedOrigins:[],installationMode:"local"};
 const endpoint={backendId:config.backendId,namespaceId:config.namespaceId,instanceId:"login-owned",serviceUid:process.getuid!(),runtimeMode:"direct",protocolVersion:1,port:54321,socketPath:directBackendSocketPath({...config,uid:process.getuid!()})};
 const socketRoot=join(endpoint.socketPath,"..");mkdirSync(socketRoot,{recursive:true,mode:0o700});roots.push(socketRoot);
 const write=(name:string,value:unknown)=>writeFileSync(join(homeDir,name),typeof value==="string"?value:JSON.stringify(value),{mode:0o600});
 write("service-config.json",config);write("identity.json",{backendId:config.backendId,namespaceId:config.namespaceId});write("state/endpoint.json",endpoint);write("credentials/host-secret","a".repeat(64));
 const capabilities:Record<string,unknown>={durableOperations:true,workstationBrowserImportSourcesV1:true,workstationBrowserCookieImportV1:true,workstationBrowserOpenV1:true,workstationBrowserNavigationV1:true,workstationBrowserEvaluationV1:true};
 let sources:unknown[]=[chrome,opera,{...opera,id:"/Desktop/Opera GX/Default",browserKey:"opera-gx",browserName:"Opera GX"}];
 let result:unknown={imported:2,skipped:1,keyUnavailable:false},receiptOverride:((receipt:Record<string,unknown>)=>unknown)|undefined;
 const calls:Array<{path:string,method:string,authenticated:boolean,input?:unknown}>=[];
 const server=createServer(async(req,res)=>{
  const path=(req.url??"").split("?")[0]!,authenticated=req.headers.authorization===`Bearer ${"a".repeat(64)}`;
  const call={path,method:req.method??"GET",authenticated,input:undefined as unknown};calls.push(call);res.setHeader("Content-Type","application/json");if(!authenticated){res.writeHead(401);res.end("{}");return;}
  if(path==="/direct/describe"){res.end(JSON.stringify({...endpoint,capabilities,cloudAccountRequired:false}));return;}
  let value:unknown;
  if(path==="/trpc/direct.browserImportSourcesV1")value={sources};
  else if(path==="/trpc/direct.browserImportCookiesV1"){
   let body="";for await(const b of req)body+=b;const input=JSON.parse(body)["0"].json;call.input=input;
   const receipt={operationId:input.operationId,procedure:"browser.importCookiesV1",status:"completed",result};value=receiptOverride?receiptOverride(receipt):receipt;
  }else throw Error("Unexpected owned fixture procedure "+path);
  res.end(JSON.stringify([{result:{data:SuperJSON.serialize(value)}}]));
 });servers.push(server);await new Promise<void>(r=>server.listen(endpoint.socketPath,r));chmodSync(endpoint.socketPath,0o600);
 return{homeDir,calls,capabilities,setSources:(v:unknown[])=>{sources=v;},setResult:(v:unknown)=>{result=v;},setReceipt:(v:typeof receiptOverride)=>{receiptOverride=v;}};
}
function run(options:Record<string,unknown>){return importLogin.run({ctx:{config:{},bearer:"",authSource:"direct",api:createUnavailableApiClient()},args:{} as never,options:{workspace:"workspace",pane:"pane",...options} as never,signal:new AbortController().signal}) as Promise<{data:unknown,message:string}>;}
const writes=(f:Awaited<ReturnType<typeof fixture>>)=>f.calls.filter(c=>c.method==="POST");
test("import-login parser accepts explicit namespace and stable operation id with original source/profile flags",()=>{
 const configs=Object.fromEntries(Object.entries(importLogin.options??{}).map(([k,b])=>[camelToKebab(k),{...b._.config,name:k}]));
 expect(parseArgv(["bun","superset","browser","import-login","--namespace","/Owned namespace","--operation-id",crypto.randomUUID(),"--workspace","work","--pane","page","--from","Chrome","--profile","中文"],configs).options).toMatchObject({namespace:"/Owned namespace",workspace:"work",pane:"page",from:"Chrome",profile:"中文"});
});
test("namespace source listing preserves original source metadata and needs no operation id or Superset account",async()=>{
 const f=await fixture(),r=await run({namespace:f.homeDir});expect(r.data).toEqual([chrome,opera,{...opera,id:"/Desktop/Opera GX/Default",browserKey:"opera-gx",browserName:"Opera GX"}]);expect(r.message).toContain("Google Chrome — Main 中文");expect(writes(f)).toEqual([]);expect(f.calls.map(c=>c.path)).toEqual(["/direct/describe","/trpc/direct.browserImportSourcesV1"]);expect(f.calls.every(c=>c.authenticated)).toBe(true);
});
test("namespace import reuses original browser precedence, opaque desktop source id and aggregate output",async()=>{
 const f=await fixture(),operationId=crypto.randomUUID(),r=await run({namespace:f.homeDir,from:"Opera",operationId});expect(r).toEqual({data:{imported:2,skipped:1,keyUnavailable:false},message:"Imported 2 logins from Opera — Main into pane (1 skipped). Reload the pane to use them."});expect(writes(f)).toHaveLength(1);expect(writes(f)[0]?.input).toEqual({operationId,workspaceId:"workspace",paneId:"pane",sourceId:opera.id});expect(f.calls.every(c=>c.authenticated)).toBe(true);
});
test("original profile disambiguation and missing-source errors do not send mutations",async()=>{
 const f=await fixture();f.setSources([chrome,{...chrome,id:"/Desktop/Mac 中文/Chrome/Profile 1",profileName:"Work"}]);
 await expect(run({namespace:f.homeDir,from:"Chrome",operationId:crypto.randomUUID()})).rejects.toThrow("matches several profiles");await expect(run({namespace:f.homeDir,from:"unknown",operationId:crypto.randomUUID()})).rejects.toThrow('No browser matching "unknown"');expect(writes(f)).toEqual([]);
 const r=await run({namespace:f.homeDir,from:"Chrome",profile:"中文",operationId:crypto.randomUUID()});expect(writes(f)[0]?.input).toMatchObject({sourceId:chrome.id});expect(r.message).toContain("Main 中文");f.setSources([]);await expect(run({namespace:f.homeDir})).rejects.toThrow("No Chromium browsers found to import from");expect(writes(f)).toHaveLength(1);
});
test("the original key-unavailable and singular import outputs retain only aggregate result fields",async()=>{
 const f=await fixture();f.setResult({imported:0,skipped:0,keyUnavailable:true,cookieValue:"never-return-this"});const r=await run({namespace:f.homeDir,from:"Chrome",operationId:crypto.randomUUID()});expect(r.data).toEqual({imported:0,skipped:0,keyUnavailable:true});expect(r.message).toContain("Keychain key was unavailable");expect(JSON.stringify(r)).not.toContain("never-return-this");f.setResult({imported:1,skipped:0,keyUnavailable:false});expect((await run({namespace:f.homeDir,from:"Chrome",operationId:crypto.randomUUID()})).message).toContain("Imported 1 login from");
});
test("import validates flags before namespace credentials and preserves original account routing",async()=>{
 await expect(run({namespace:"/does-not-exist",from:"Chrome"})).rejects.toThrow("requires --operation-id");await expect(run({namespace:"/does-not-exist",host:"host",from:"Chrome",operationId:crypto.randomUUID()})).rejects.toThrow("not both");await expect(run({namespace:"/does-not-exist",from:"Chrome",operationId:"bad"})).rejects.toThrow("Invalid UUID");await expect(run({operationId:crypto.randomUUID()})).rejects.toThrow("requires --namespace");await expect(run({})).rejects.toThrow("organization");
});
test("sources read requires its own capability and importing requires ready plus durable capabilities",async()=>{
 const f=await fixture();for(const name of ["workstationBrowserImportSourcesV1","workstationBrowserCookieImportV1","durableOperations"]){f.capabilities[name]=false;await expect(run({namespace:f.homeDir,from:"Chrome",operationId:crypto.randomUUID()})).rejects.toThrow(/capability/);f.capabilities[name]=true;}expect(writes(f)).toEqual([]);
});
test("each explicit namespace transport rejects other writes and cookie import batching before sending",async()=>{
 const f=await fixture();for(const resolver of [resolveDirectNamespace,resolveBrowserNavigationNamespace,resolveBrowserEvaluationNamespace,resolveBrowserOpenNamespace]){const t=await resolver(f.homeDir);await expect(t.client.direct.browserImportCookiesV1.mutate({operationId:crypto.randomUUID(),workspaceId:"workspace",paneId:"pane",sourceId:chrome.id})).rejects.toThrow("read-only");}
 const t=await resolveBrowserImportNamespace(f.homeDir);await expect(t.client.direct.browserNavigateV1.mutate({operationId:crypto.randomUUID(),workspaceId:"workspace",paneId:"pane",url:"about:blank"})).rejects.toThrow("read-only");
 const input={operationId:crypto.randomUUID(),workspaceId:"workspace",paneId:"pane",sourceId:chrome.id};const batched=await Promise.allSettled([t.client.direct.browserImportCookiesV1.mutate(input),t.client.direct.browserImportCookiesV1.mutate({...input,operationId:crypto.randomUUID()})]);expect(batched.every(r=>r.status==="rejected")).toBe(true);expect(writes(f)).toEqual([]);
});
test("incomplete, mismatched or malformed import receipts never report success or retry",async()=>{
 const f=await fixture(),operationId=crypto.randomUUID();const variants:Array<(r:Record<string,unknown>)=>unknown>=[r=>({...r,status:"accepted"}),r=>({...r,status:"unresolved"}),r=>({...r,status:"failed"}),r=>({...r,operationId:crypto.randomUUID()}),r=>({...r,procedure:"browser.openV1"}),r=>({...r,result:{imported:-1,skipped:0,keyUnavailable:false}}),r=>({...r,result:{imported:0,skipped:0}}),()=>null];
 for(const override of variants){f.setReceipt(override);const previous=writes(f).length;try{await run({namespace:f.homeDir,from:"Chrome",operationId});throw Error("Expected invalid receipt rejection");}catch(error){expect(String(error)).not.toContain("Expected invalid");expect((error as {hint?:string}).hint??JSON.stringify(error)).toContain("operation-status");}expect(writes(f)).toHaveLength(previous+1);}
});
''')
