import os,sys,json,time,subprocess,uuid
from pathlib import Path
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-105')/sys.argv[1];out.mkdir(exist_ok=False);config=out/'config';config.mkdir();(out/'pictures').mkdir();(config/'user-dirs.dirs').write_text('XDG_PICTURES_DIR="'+str(out/'pictures')+'"\n')
(out/'import-fixture.json').write_text(json.dumps({'marker':'OWNED-IMPORT-'+str(uuid.uuid4()),'defaultId':str(config/'google-chrome/Default'),'emptyId':str(config/'google-chrome/Profile 1'),'configRoot':str(config)},indent=2)+'\n')
assert not Path('/tmp/.X11-unix/X163').exists(),'Display in use';xlog=open(out/'xorg-launch.log','wb');x=subprocess.Popen(['/usr/lib/xorg/Xorg',':163','-config','/workspace/.cloud-onboarding/superset/runtime-verification-20261012/xorg.conf','-noreset','-nolisten','tcp','-logfile',str(out/'xorg.log')],stdout=xlog,stderr=subprocess.STDOUT);result=None
try:
 for i in range(100):
  if Path('/tmp/.X11-unix/X163').exists():break
  assert x.poll() is None,'Owned Xorg exited';time.sleep(.1)
 assert Path('/tmp/.X11-unix/X163').exists(),'Owned Xorg not ready'
 env=os.environ.copy();env.update(DISPLAY=':163',XDG_CONFIG_HOME=str(config),BRAND_VERIFY_EXECUTABLE=str(root/'apps/desktop/node_modules/electron/dist/electron'),SUPERSET_WORKSPACE_ID='parity105-'+sys.argv[1],GITHUB_SHA=sys.argv[2]);mode='--restore-windows' if '--ssh' in sys.argv else '--local-wheel-only'
 with open(out/'native.log','wb') as log:result=subprocess.run(['node','--import','tsx','scripts/verify-brand-ui.mjs',str(root/'apps/desktop'),str(out/'app'),'--source-test',mode,'--browser-ui-only','--browser-read-cli','--browser-capture-cli','--browser-navigation-api','--browser-navigation-cli','--cdp-diagnostic'],cwd=root/'apps/desktop',env=env,stdout=log,stderr=subprocess.STDOUT)
 print(sys.argv[1],result.returncode,flush=True)
finally:
 if x.poll() is None:
  x.terminate()
  try:x.wait(timeout=10)
  except subprocess.TimeoutExpired:x.kill();x.wait()
 xlog.close();(out/'owned-cleanup.json').write_text(json.dumps({'ownedXorgPid':x.pid,'ownedXorgExit':x.returncode,'appExit':result.returncode if result else None},indent=2)+'\n')
if result:sys.exit(result.returncode)
