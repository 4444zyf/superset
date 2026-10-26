from pathlib import Path
r=Path('/workspace/superset');p=r/'apps/desktop/scripts/verify-brand-ui.mjs';s=p.read_text();s=s.replace('import {\n\texistsSync,','import {\n appendFileSync,\n\texistsSync,',1);a=s.index('async function connect(entry) {');s=s[:a]+'''let cdpConnectionIndex=0,cdpTraceCount=0;
function diagnosticCdpTrace(record) {
 if(!process.argv.includes("--cdp-diagnostic"))return;
 if(++cdpTraceCount>12000)return;
 appendFileSync(join(output,"cdp-diagnostic.ndjson"),JSON.stringify({time:Date.now(),...record})+"\\n");
}
'''+s[a:];s=s.replace('async function connect(entry) {','''async function connect(entry) {
 const scope=entry.type==='node'?'main':entry.url?.startsWith('devtools:')?'devtools':'renderer';
 const connection=++cdpConnectionIndex;''',1);s=s.replace('\t\t\tclearTimeout(callback.timer);','''\t\t\tclearTimeout(callback.timer);
 diagnosticCdpTrace({...callback.diagnostic,phase:'reply',elapsed:performance.now()-callback.started,protocolError:Boolean(message.error),evaluationException:Boolean(message.result?.exceptionDetails)});''',1);needle='\t\t\tconst id = ++next;\n';assert needle in s;s=s.replace(needle,needle+'''const started=performance.now();
 const diagnostic={scope,connection,id,method,caller:process.argv.includes('--cdp-diagnostic')?new Error().stack?.split('\\n').slice(2,10).join('\\n'):undefined};
 diagnosticCdpTrace({...diagnostic,phase:'request'});
''',1);s=s.replace('\t\t\t\tpending.delete(id);\n\t\t\t\treject(new Error(`Timeout: ${method}`));','''\t\t\t\tpending.delete(id);
 diagnosticCdpTrace({...diagnostic,phase:'timeout',elapsed:performance.now()-started});
\t\t\t\treject(new Error(`Timeout: ${method}${process.argv.includes('--cdp-diagnostic')?' ['+scope+' #'+id+']':''}`));''',1);s=s.replace('pending.set(id, { accept, reject, timer });','pending.set(id, { accept, reject, timer, started, diagnostic });',1);p.write_text(s)
p=Path('/workspace/scratch/parity-92/tools-native.py');v=Path('/workspace/scratch/parity-91/browser-sites-native.py').read_text().replace('parity-91','parity-92').replace('parity91-','parity92-').replace("'--browser-sites'","'--cdp-diagnostic'");p.write_text(v)
