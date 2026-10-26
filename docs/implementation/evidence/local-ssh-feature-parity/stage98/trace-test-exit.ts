import { appendFileSync } from "node:fs";
const output="/workspace/scratch/parity-98/test-exit-trace.ndjson";
function record(event:string,code?:unknown,stack?:string){appendFileSync(output,JSON.stringify({event,code,exitCode:process.exitCode,stack,resources:typeof process.getActiveResourcesInfo==="function"?process.getActiveResourcesInfo():[]})+"\n");}
const descriptor=Object.getOwnPropertyDescriptor(process,"exitCode");
record("preload");
if(descriptor?.get&&descriptor.set&&descriptor.configurable){const original=descriptor;Object.defineProperty(process,"exitCode",{...descriptor,get(){return original.get!.call(this);},set(value){record("exitCode-assigned",value,new Error().stack);original.set!.call(this,value);}});}
process.on("beforeExit",code=>record("beforeExit",code));
process.on("exit",code=>record("exit",code));
process.on("uncaughtExceptionMonitor",error=>record("uncaughtExceptionMonitor",error.name,error.stack));
