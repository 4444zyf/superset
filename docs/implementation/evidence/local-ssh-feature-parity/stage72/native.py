import os,sys,json,subprocess,time,socket,urllib.request
from pathlib import Path
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-72');name=sys.argv[1]
run=out/name;run.mkdir(exist_ok=False)
assert not Path('/tmp/.X11-unix/X163').exists(),'Display in use'
xlog=open(run/'xorg-launch.log','wb')
x=subprocess.Popen(['/usr/lib/xorg/Xorg',':163','-config','/workspace/.cloud-onboarding/superset/runtime-verification-20261012/xorg.conf','-noreset','-nolisten','tcp','-logfile',str(run/'xorg.log')],stdout=xlog,stderr=subprocess.STDOUT)
chrome=None;chrome_log=None;result=None
try:
 for i in range(100):
  if Path('/tmp/.X11-unix/X163').exists():break
  assert x.poll() is None,'Owned Xorg exited'
  time.sleep(.1)
 assert Path('/tmp/.X11-unix/X163').exists(),'Owned Xorg not ready'
 with socket.socket() as s:s.bind(('127.0.0.1',0));debug_port=s.getsockname()[1]
 env=os.environ.copy();env.update(DISPLAY=':163',XDG_CONFIG_HOME=str(run/'config'),XDG_DATA_HOME=str(run/'share'),XDG_CURRENT_DESKTOP='',DE='generic',OWNED_PORT_BROWSER_PROFILE=str(run/'chrome-profile'),OWNED_PORT_BROWSER_LOG=str(run/'browser-launches.jsonl'),BRAND_VERIFY_EXECUTABLE=str(root/'apps/desktop/node_modules/electron/dist/electron'),SUPERSET_WORKSPACE_ID='parity66-'+name,GITHUB_SHA=sys.argv[2])
 handler=run/'owned-browser'
 handler.write_text('''#!/usr/bin/python3
import os,sys,json,subprocess,time
from urllib.parse import urlsplit
url=sys.argv[1];u=urlsplit(url)
assert u.scheme=='http' and u.hostname in ('127.0.0.1','localhost') and u.port and not u.username
with open(os.environ['OWNED_PORT_BROWSER_LOG'],'a') as f:f.write(json.dumps({'url':url,'handlerPid':os.getpid(),'timeNs':time.time_ns()})+'\\n')
subprocess.run(['/usr/bin/chromium','--no-sandbox','--user-data-dir='+os.environ['OWNED_PORT_BROWSER_PROFILE'],url],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
''');handler.chmod(0o700)
 share=run/'share/applications';share.mkdir(parents=True)
 (share/'owned-browser.desktop').write_text('[Desktop Entry]\nType=Application\nName=Owned verification browser\nNoDisplay=true\nExec='+str(handler)+' %u\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\n')
 config=run/'config';config.mkdir()
 (config/'mimeapps.list').write_text('[Default Applications]\nx-scheme-handler/http=owned-browser.desktop\nx-scheme-handler/https=owned-browser.desktop\n')
 assert subprocess.check_output(['xdg-mime','query','default','x-scheme-handler/http'],env=env,text=True).strip()=='owned-browser.desktop'
 chrome_log=open(run/'chromium.log','wb')
 chrome=subprocess.Popen(['/usr/bin/chromium','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+env['OWNED_PORT_BROWSER_PROFILE'],'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+str(debug_port),'about:blank'],env=env,stdout=chrome_log,stderr=subprocess.STDOUT)
 for i in range(100):
  assert chrome.poll() is None,'Owned Chromium exited'
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+str(debug_port)+'/json/list',timeout=1) as r:pages=json.load(r)
   if any(p.get('url')=='about:blank' for p in pages):break
  except Exception:pass
  time.sleep(.1)
 else:raise AssertionError('Owned Chromium not ready')
 (run/'browser-identity.json').write_text(json.dumps({'ownedChromiumPid':chrome.pid,'debugPort':debug_port,'profile':env['OWNED_PORT_BROWSER_PROFILE'],'initialPages':pages},indent=2)+'\n')
 with open(run/'native.log','wb') as log:
  result=subprocess.run(['node','--import','tsx','scripts/verify-brand-ui.mjs',str(root/'apps/desktop'),str(run/'app'),'--source-test',*(['--local-parity-only'] if len(sys.argv)>3 and sys.argv[3]=='local' else ['--restore-windows']),'--ports-only','--port-discovery','--port-copy','--port-multiple'],cwd=root/'apps/desktop',env=env,stdout=log,stderr=subprocess.STDOUT)
 print(name,result.returncode,flush=True)
finally:
 for proc in [chrome,x]:
  if proc is not None and proc.poll() is None:
   proc.terminate()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
 if chrome_log:chrome_log.close()
 xlog.close()
 (run/'owned-cleanup.json').write_text(json.dumps({'ownedXorgPid':x.pid,'ownedXorgExit':x.returncode,'ownedChromiumPid':chrome.pid if chrome else None,'ownedChromiumExit':chrome.returncode if chrome else None,'appExit':result.returncode if result else None},indent=2)+'\n')
if result:sys.exit(result.returncode)
