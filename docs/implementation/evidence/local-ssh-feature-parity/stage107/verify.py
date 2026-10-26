from pathlib import Path
import hashlib,json,os
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-107');dist=root/'apps/desktop/dist'
product=json.loads((out/'product-snapshot.json').read_text());fixtures=json.loads((out/'fixture-snapshot.json').read_text())
changed=[r['path'] for r in product['files'] if hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()!=r['sha256']]
assert not changed,changed
fixtureChanged=[p for p,h in fixtures.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h];assert not fixtureChanged,fixtureChanged
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
assert not Path('/tmp/.X11-unix/X163').exists()
report={'source':product['sourceCommit'],'compiledFiles':len(product['files']),'compiledChanged':changed,'fixtureCount':len(fixtures),'fixturesChanged':fixtureChanged,'cliSha256':cli,'x163Released':True,'native':[]}
for name in ['local-focus-eval-7b2892','ssh-focus-eval-7b2892']:
 case=out/name;app=case/'app'
 nav=json.loads((app/'browser-navigation-cli.json').read_text());api=json.loads((app/'browser-navigation-api.json').read_text());read=json.loads((app/'browser-read-cli.json').read_text());browser=json.loads((app/'browser-ui.json').read_text());identity=json.loads((app/'observed-identity.json').read_text());cleanup=json.loads((case/'owned-cleanup.json').read_text())
 assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 assert len(nav['calls'])==12 and sum(c['code']==0 for c in nav['calls'])==9
 evalReport=json.loads((app/'browser-evaluation-api.json').read_text())
 statuses=[c['status'] for c in evalReport['calls']]
 assert statuses==[200,200,409,400,200,200,200,200,400,200,412,200,200,200,200],statuses
 assert evalReport['undefinedResultPreserved']
 assert evalReport['completed']['oneEvaluationForRepeatedId'] and evalReport['completed']['failedEvaluationNotRetried'] and evalReport['completed']['backgroundTabAndFocusPreserved']
 assert evalReport['reopened']['noReplayOrRetarget']
 assert nav['completed']['oneRequestForRepeatedId'] and nav['completed']['backgroundTabAndFocusPreserved'] and nav['reopened']['noReplayOrRetarget']
 assert len(api['calls'])==9 and [c['status'] for c in api['calls']]==[200,200,409,400,200,200,200,200,200]
 assert len(read['calls'])==11
 before=browser['terminalBefore'];after=browser['terminalAfter']
 for key in ['id','executionId','pid','cwd']:assert before[key]==after[key],key
 for capture in ['initialCapture','hiddenCapture','reopenedCapture']:
  assert read[capture]['clipboardUnchanged'];assert read[capture]['image']['corner']==[255]*4
 pids=[]
 for field,pid in [('observed-identity.pid',identity['pid']),('terminalBefore.pid',before['pid']),('detectedPort.pid',browser['detectedPort']['pid']),('terminalAfter.pid',after['pid']),('cleanup.pid',browser['cleanup']['pid'])]:
  alive=Path('/proc/'+str(pid)).exists();assert not alive,(field,pid);pids.append({'field':field,'pid':pid,'exists':alive})
 events=[e for e in browser['guestEventsBeforeReopen'] if e.get('type')=='did-navigate' and '/cli-owned-' in e.get('url','')]
 assert any('/cli-owned-navigation' in e['url'] for e in events)
 report['native'].append({'case':name,'evaluationApiStatuses':statuses,'evaluationCompleted':evalReport['completed'],'evaluationReopened':evalReport['reopened'],'undefinedResultPreserved':True,'cliExitCodes':[c['code'] for c in nav['calls']],'cliCompleted':nav['completed'],'cliReopened':nav['reopened'],'rawCliGuestNavigationEvents':events,'apiStatuses':[c['status'] for c in api['calls']],'readCaptureExitCodes':[c['code'] for c in read['calls']],'samePty':True,'sameExecution':True,'sameCwd':True,'ownedPids':pids,'cleanup':cleanup})
failed=out/'local-eval-7b2892'
failedCleanup=json.loads((failed/'owned-cleanup.json').read_text());assert failedCleanup=={'ownedXorgPid':failedCleanup['ownedXorgPid'],'ownedXorgExit':0,'appExit':1}
failedBrowser=json.loads((failed/'app/browser-ui.json').read_text());failedIdentity=json.loads((failed/'app/observed-identity.json').read_text())
failedPids=[failedIdentity['pid'],failedBrowser['terminalBefore']['pid'],failedBrowser['detectedPort']['pid']]
assert all(not Path('/proc/'+str(pid)).exists() for pid in failedPids)
firstFixtures=json.loads((out/'fixture-snapshot-first.json').read_text())
changedFixtures=[p for p,h in firstFixtures.items() if fixtures[p]!=h]
assert set(changedFixtures)=={'apps/desktop/scripts/verify-workstation-browser-navigation-cli-ui.mjs','apps/desktop/scripts/verify-workstation-browser-navigation-api-ui.mjs','apps/desktop/scripts/verify-workstation-browser-evaluation-api-ui.mjs'}
report['fixtureSource']=json.loads((out/'fixture-source.json').read_text())
report['initialFailure']={'case':'local-eval-7b2892','phase':'Existing navigation CLI focus assertion before evaluation suite','expectedBaselineFocus':'BODY','actualLaterFocus':'xterm-helper-textarea','correction':'Read-only wait for actual terminal input focus before baseline, original gestures and assertions retained','cleanup':failedCleanup,'pidsGone':failedPids,'fixtureFilesChangedBeforeNewFreeze':changedFixtures}
(out/'final-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'compiledFiles':len(product['files']),'fixtures':len(fixtures),'nativeCases':len(report['native']),'allPassed':True}))
