import os, json, subprocess, time
from pathlib import Path
root=Path('/workspace/superset')
out=Path('/workspace/scratch/parity-62')
socket=Path('/tmp/.X11-unix/X163')
assert not socket.exists(), 'Display already in use'
xlog=open(out/'xorg-launch.log','wb')
x=subprocess.Popen(['/usr/lib/xorg/Xorg',':163','-config','/workspace/.cloud-onboarding/superset/runtime-verification-20261012/xorg.conf','-noreset','-nolisten','tcp','-logfile',str(out/'xorg.log')],stdout=xlog,stderr=subprocess.STDOUT)
results=[]
try:
 for i in range(100):
  if socket.exists(): break
  assert x.poll() is None, 'Owned Xorg exited'
  time.sleep(.1)
 assert socket.exists(), 'Owned Xorg not ready'
 for name,flags in [('final-local',['--local-wheel-only','--wheel-mode-transitions']),('final-ssh',['--restore-windows','--wheel-only','--wheel-mode-transitions'])]:
  env=os.environ.copy()
  env.update(DISPLAY=':163',XDG_CONFIG_HOME=str(out/('config-'+name)),BRAND_VERIFY_EXECUTABLE=str(root/'apps/desktop/node_modules/electron/dist/electron'),SUPERSET_WORKSPACE_ID='parity62-'+name,GITHUB_SHA=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip())
  with open(out/(name+'.log'),'wb') as log:
   result=subprocess.run(['node','--import','tsx','scripts/verify-brand-ui.mjs',str(root/'apps/desktop'),str(out/name),'--source-test',*flags],cwd=root/'apps/desktop',env=env,stdout=log,stderr=subprocess.STDOUT)
  results.append({'name':name,'exitCode':result.returncode})
  (out/'native-results.json').write_text(json.dumps(results,indent=2)+'\n')
  print(name,result.returncode,flush=True)
  if result.returncode: break
finally:
 if x.poll() is None:
  x.terminate()
  try: x.wait(timeout=10)
  except subprocess.TimeoutExpired: x.kill(); x.wait()
 xlog.close()
 (out/'native-cleanup.json').write_text(json.dumps({'ownedXorgPid':x.pid,'ownedXorgExit':x.returncode,'results':results},indent=2)+'\n')
