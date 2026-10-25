import os,sys,time,json,subprocess
from pathlib import Path
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-74')/sys.argv[1]
out.mkdir(exist_ok=False)
assert not Path('/tmp/.X11-unix/X163').exists(),'Display in use'
xlog=open(out/'xorg-launch.log','wb')
x=subprocess.Popen(['/usr/lib/xorg/Xorg',':163','-config','/workspace/.cloud-onboarding/superset/runtime-verification-20261012/xorg.conf','-noreset','-nolisten','tcp','-logfile',str(out/'xorg.log')],stdout=xlog,stderr=subprocess.STDOUT)
e=None;result=1
try:
 for i in range(100):
  if Path('/tmp/.X11-unix/X163').exists():break
  assert x.poll() is None,'Owned Xorg exited'
  time.sleep(.1)
 assert Path('/tmp/.X11-unix/X163').exists(),'Owned Xorg not ready'
 env=os.environ.copy();env.update(DISPLAY=':163');env.pop('ELECTRON_RUN_AS_NODE',None)
 with open(out/'electron.log','wb') as log:
  e=subprocess.Popen([str(root/'apps/desktop/node_modules/electron/dist/electron'),'--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','/workspace/scratch/parity-74/native-browser-boundary.mjs',str(out)],cwd=root/'apps/desktop',env=env,stdout=log,stderr=subprocess.STDOUT)
  result=e.wait(timeout=40)
finally:
 for proc in [e,x]:
  if proc is not None and proc.poll() is None:
   proc.terminate()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
 xlog.close()
 (out/'owned-cleanup.json').write_text(json.dumps({'xorgPid':x.pid,'xorgExit':x.returncode,'electronPid':e.pid if e else None,'electronExit':e.returncode if e else None},indent=2)+'\n')
print('native-boundary',result)
sys.exit(result)
