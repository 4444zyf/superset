from pathlib import Path
import json,hashlib,subprocess
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-132');old=root/'docs/implementation/evidence/local-ssh-feature-parity/stage127';base='538e4f8e5';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
product=json.load(open(old/'product-snapshot.json'));fixtures=json.load(open(old/'fixture-snapshot.json'));cli=json.load(open(old/'source-cli-snapshot.json'))
assert all(sha(root/'apps/desktop/dist'/p['path'])==p['sha256'] for p in product['files']);assert all(sha(root/p)==h for p,h in fixtures.items());assert all(sha(root/p)==h for p,h in cli.items())
proof={'compiledSource':product['sourceCommit'],'compiledFilesVerified':len(product['files']),'consumedMjsVerified':len(fixtures),'sourceCliFilesVerified':len(cli),'bundledCliSha256':sha(root/'apps/desktop/dist/resources/bin/superset'),'newBuildOrNativeAcceptance':False}
(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'compiledFiles':len(product['files']),'mjs':len(fixtures),'cliSourceFiles':len(cli),'allPassed':True}))
