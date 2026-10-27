import {readFileSync,writeFileSync} from "node:fs";
const log="/workspace/scratch/parity-122/local-cookie-diagnostic/native.log";
let url;for(let i=0;i<100;i++){try{const body=readFileSync("/workspace/scratch/parity-122/local-cookie-diagnostic/app/application-log.txt","utf8");url=body.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];}catch{}if(url)break;await new Promise(r=>setTimeout(r,100));}
// The harness buffers logs, so query the owned Electron process argv and its explicit loopback inspector port instead.
if(!url){const {execFileSync}=await import("node:child_process");for(let i=0;i<100;i++){const rows=execFileSync("ps",["-eo","pid,args"],{encoding:"utf8"}).split("\n");const row=rows.find(l=>l.includes("--inspect=127.0.0.1:")&&l.includes("/workspace/superset/apps/desktop"));if(row){const port=row.match(/--inspect=127.0.0.1:(\d+)/)[1];const targets=await fetch("http://127.0.0.1:"+port+"/json/list").then(r=>r.json());url=targets[0].webSocketDebuggerUrl;break;}await new Promise(r=>setTimeout(r,100));}}
if(!url)throw Error("Owned inspector not found");
const socket=new WebSocket(url);await new Promise(r=>socket.addEventListener("open",r,{once:true}));let id=0;const pending=new Map();socket.addEventListener("message",event=>{const p=JSON.parse(event.data);if(p.id){const r=pending.get(p.id);pending.delete(p.id);r?.(p);} });const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);socket.send(JSON.stringify({id:n,method,params}));});
await send("Debugger.enable");
const src=readFileSync("/workspace/superset/apps/desktop/dist/main/index.js","utf8").split("\n");const line=src.findIndex(l=>l.includes("error instanceof WorkstationBrowserCookieImportError"));if(line<0)throw Error("Missing exact diagnostic breakpoint");
const result=await send("Debugger.setBreakpointByUrl",{urlRegex:"/dist/main/index\\.js$",lineNumber:line,condition:'console.error("[owned-cookie-diagnostic]",error.name,error.message);false'});writeFileSync("/workspace/scratch/parity-122/diagnostic-breakpoint.json",JSON.stringify({line,result},null,2));
await new Promise(r=>socket.addEventListener("close",r,{once:true}));
