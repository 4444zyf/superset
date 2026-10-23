import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire('/workspace/superset/packages/pty-daemon/package.json');
const pty=require('node-pty');
const home='/workspace/scratch/parity-61';
const fixtures=[['bash','/bin/bash',['--noprofile','--norc','-c',`trap 'printf "WINCH\\n"' WINCH; printf 'READY\\n'; while IFS= read -r line; do printf 'INPUT %s\\n' "$line"; done`]],['python','/usr/bin/python3',['-u','-c',`import os,signal,sys\nsignal.signal(signal.SIGWINCH,lambda *_:os.write(1,b'WINCH\\n'))\nprint('READY',flush=True)\nfor line in sys.stdin: print('INPUT '+line.strip(),flush=True)`]]];
const results=[];
for(const [name,shell,args] of fixtures){
 const term=pty.spawn(shell,args,{cols:80,rows:24,cwd:home,env:{PATH:process.env.PATH,HOME:home,TERM:'xterm-256color'},encoding:null});
 let output='';let exited=false;const exit=new Promise(r=>term.onExit(e=>{exited=true;r(e);}));
 term.onData(data=>{output+=data.toString();});
 const waitFor=async text=>{for(let i=0;i<100;i++){if(output.includes(text))return;await delay(10);}throw Error('No '+text);};
 try{
  await waitFor('READY');
  const status=readFileSync(`/proc/${term.pid}/status`,'utf8').split('\n').filter(l=>/^Sig(Blk|Ign|Cgt):/.test(l));
  const stat=readFileSync(`/proc/${term.pid}/stat`,'utf8');const parts=stat.slice(stat.lastIndexOf(')')+2).split(' ');
  term.resize(100,30);await delay(200);const afterResize=output;
  term.write('probe\r');await waitFor('INPUT probe');await delay(20);
  results.push({name,pid:term.pid,pgrp:parts[2],tpgid:parts[5],status,afterResize,afterInput:output});
 }finally{if(!exited)term.kill('SIGHUP');await exit;}
}
writeFileSync(home+'/resize-probe.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
