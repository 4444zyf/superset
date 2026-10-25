import os,sys,json,time,subprocess,sqlite3,hashlib,uuid
from pathlib import Path
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-88')/sys.argv[1];out.mkdir(exist_ok=False);config=out/'config';config.mkdir()
(out/'pictures').mkdir();(config/'user-dirs.dirs').write_text('XDG_PICTURES_DIR=\"'+str(out/'pictures')+'\"\n')
server_script=out/'import-server.py';server_script.write_text('''import http.server,json,os,signal,sys
from pathlib import Path
root=Path(sys.argv[1]);marker=sys.argv[2];state={"pid":os.getpid(),"marker":marker,"requests":[],"running":True}
def save():
 p=root/'import-server-proof.tmp';p.write_text(json.dumps(state));p.replace(root/'import-server-proof.json')
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  state['requests'].append(self.path);save();body=('<!doctype html><meta charset="utf-8"><title>Owned imported page 中文</title><h1>'+marker+'</h1>').encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
server=http.server.HTTPServer(('127.0.0.1',0),Handler);state['port']=server.server_port;save()
def stop(*args):raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
try:server.serve_forever()
finally:server.server_close();state['running']=False;save()
''')
marker='OWNED-IMPORT-'+str(uuid.uuid4());server_log=open(out/'import-server.log','wb');server=subprocess.Popen(['python3',str(server_script),str(out),marker],stdout=server_log,stderr=subprocess.STDOUT);x=None;result=None;xlog=None
try:
 for i in range(100):
  if (out/'import-server-proof.json').exists():break
  assert server.poll() is None,'Owned import HTTP server exited';time.sleep(.1)
 state=json.loads((out/'import-server-proof.json').read_text());url='http://localhost:'+str(state['port'])+'/import?marker='+marker+'&value=%E4%B8%AD#owned'
 browser=config/'google-chrome';default=browser/'Default';empty=browser/'Profile 1'
 def history(directory,rows):
  directory.mkdir(parents=True);db=sqlite3.connect(directory/'History');db.execute('CREATE TABLE urls(url TEXT,title TEXT,visit_count INTEGER,last_visit_time INTEGER)');db.executemany('INSERT INTO urls VALUES (?,?,?,?)',rows);db.commit();db.close()
 timestamp=(1577836800000+11644473600000)*1000
 rows=[(url,'',99,timestamp)]+[('https://imported-owned.test/'+marker+'/'+str(i),'Imported 中文 '+str(i),7,timestamp+i*1000000) for i in range(201)]
 history(default,rows);history(empty,[]);(browser/'Local State').write_text(json.dumps({'profile':{'info_cache':{'Default':{'name':'Owned history 中文'},'Profile 1':{'name':'Owned empty'}}}}))
 files=[default/'History',empty/'History',browser/'Local State'];(out/'import-fixture.json').write_text(json.dumps({'marker':marker,'url':url,'defaultId':str(default),'emptyId':str(empty),'configRoot':str(config),'entryCount':len(rows),'sourceFiles':[{ 'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]},indent=2)+'\n')
 assert not Path('/tmp/.X11-unix/X163').exists(),'Display in use';xlog=open(out/'xorg-launch.log','wb');x=subprocess.Popen(['/usr/lib/xorg/Xorg',':163','-config','/workspace/.cloud-onboarding/superset/runtime-verification-20261012/xorg.conf','-noreset','-nolisten','tcp','-logfile',str(out/'xorg.log')],stdout=xlog,stderr=subprocess.STDOUT)
 for i in range(100):
  if Path('/tmp/.X11-unix/X163').exists():break
  assert x.poll() is None,'Owned Xorg exited';time.sleep(.1)
 assert Path('/tmp/.X11-unix/X163').exists(),'Owned Xorg not ready'
 env=os.environ.copy();env.update(DISPLAY=':163',XDG_CONFIG_HOME=str(config),BRAND_VERIFY_EXECUTABLE=str(root/'apps/desktop/node_modules/electron/dist/electron'),SUPERSET_WORKSPACE_ID='parity88-'+sys.argv[1],GITHUB_SHA=sys.argv[2]);mode='--restore-windows' if '--ssh' in sys.argv else '--local-wheel-only'
 with open(out/'native.log','wb') as log:result=subprocess.run(['node','--import','tsx','scripts/verify-brand-ui.mjs',str(root/'apps/desktop'),str(out/'app'),'--source-test',mode,'--browser-ui-only','--browser-tools','--browser-import','--browser-screenshots'],cwd=root/'apps/desktop',env=env,stdout=log,stderr=subprocess.STDOUT)
 print(sys.argv[1],result.returncode,flush=True)
finally:
 for process in [x,server]:
  if process and process.poll() is None:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
 if xlog:xlog.close()
 server_log.close();(out/'owned-cleanup.json').write_text(json.dumps({'ownedXorgPid':x.pid if x else None,'ownedXorgExit':x.returncode if x else None,'ownedImportServerPid':server.pid,'ownedImportServerExit':server.returncode,'appExit':result.returncode if result else None},indent=2)+'\n')
if result:sys.exit(result.returncode)
