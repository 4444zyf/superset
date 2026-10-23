import json,hashlib,sys
from pathlib import Path
root=Path('/workspace/superset');dist=root/'apps/desktop/dist';out=Path('/workspace/scratch/parity-72')
if sys.argv[1]=='verify-baseline':
 p=Path('/workspace/scratch/parity-64/product-snapshot.json');d=json.loads(p.read_text())
 for item in d['files']:assert hashlib.sha256((dist/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
 print(json.dumps({'sourceCommit':d['sourceCommit'],'filesVerified':len(d['files']),'manifestSha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
elif sys.argv[1]=='snapshot':
 items=[{'path':str(p.relative_to(dist)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for name in ['main','preload','renderer'] for p in sorted((dist/name).rglob('*')) if p.is_file()]
 assert len(items)>2000
 d={'sourceCommit':sys.argv[2],'files':items};p=out/'product-snapshot.json';p.write_text(json.dumps(d,indent=2)+'\n')
 cli=root/'apps/desktop/dist/resources/bin/superset'
 print(json.dumps({'sourceCommit':d['sourceCommit'],'filesVerified':len(items),'manifestSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'cliSha256':hashlib.sha256(cli.read_bytes()).hexdigest()}))
elif sys.argv[1]=='verify':
 p=out/'product-snapshot.json';d=json.loads(p.read_text())
 for item in d['files']:assert hashlib.sha256((dist/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
 print(json.dumps({'sourceCommit':d['sourceCommit'],'filesVerified':len(d['files']),'manifestSha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
