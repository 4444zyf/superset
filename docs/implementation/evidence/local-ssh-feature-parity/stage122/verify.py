from pathlib import Path
import hashlib,json,os
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-122');dist=root/'apps/desktop/dist'
product=json.loads((out/'product-snapshot.json').read_text());fixtures=json.loads((out/'fixture-snapshot.json').read_text())
changed=[r['path'] for r in product['files'] if hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()!=r['sha256']]
assert not changed,changed
fixtureChanged=[p for p,h in fixtures.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h];assert not fixtureChanged,fixtureChanged
sourceCli=json.loads((out/'source-cli-snapshot.json').read_text());sourceChanges=[p for p,h in sourceCli.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h];assert set(sourceChanges).issubset({'packages/cli/README.md'}),sourceChanges
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
assert not Path('/tmp/.X11-unix/X163').exists()
report={'source':product['sourceCommit'],'compiledFiles':len(product['files']),'compiledChanged':changed,'fixtureCount':len(fixtures),'fixturesChanged':fixtureChanged,'cliSha256':cli,'x163Released':True,'native':[]}
for name in ['local-cookie-import-8af01d','ssh-cookie-import-8af01d']:
 case=out/name;app=case/'app'
 nav=json.loads((app/'browser-navigation-cli.json').read_text());api=json.loads((app/'browser-navigation-api.json').read_text());read=json.loads((app/'browser-read-cli.json').read_text());browser=json.loads((app/'browser-ui.json').read_text());identity=json.loads((app/'observed-identity.json').read_text());cleanup=json.loads((case/'owned-cleanup.json').read_text())
 assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 opened=json.loads((app/'browser-open-api.json').read_text());assert len(opened['calls'])==14;assert [c['status'] for c in opened['calls']]==[200,200,409,404,400,400,200,200,200,200,200,200,200,200]
 for key in ['projectlessBrowserOnly','noTerminalCreated','backgroundSelectionAndFocusPreserved','explicitShow','newTabAndCurrentReplacement','defaultEquivalentDeduplication']:assert opened['completed'][key],key
 assert opened['completed']['httpRequestCount']==1 and opened['reopened']['noReplayOrRecreation'] and opened['reopened']['originalReceiptForClosedPane'] and opened['reopened']['requestCount']==1
 openCli=json.loads((app/'browser-open-cli.json').read_text());assert len(openCli['calls'])==15
 openCodes=[c['code'] for c in openCli['calls']];assert openCodes==[0,0,0,1,1,1,0,0,0,0,0,0,0,0,0],openCodes
 for key in ['projectlessBrowserOnly','noTerminalCreated','backgroundSelectionAndFocusPreserved','explicitShow','newTabAndCurrentReplacement','defaultEquivalentDeduplication']:assert openCli['completed'][key],key
 assert openCli['completed']['httpRequestCount']==1 and openCli['reopened']['noReplayOrRecreation'] and openCli['reopened']['originalReceiptForClosedPane'] and openCli['reopened']['requestCount']==1
 reloadApi=json.loads((app/'browser-reload-api.json').read_text());reloadStatuses=[c['status'] for c in reloadApi['calls']];assert reloadStatuses==[200,200,409,400,400,200,200,200,200,200,200,200],reloadStatuses
 assert reloadApi['completed']['requestsAfter']==reloadApi['completed']['baseline']+2
 for key in ['oneRequestPerNewOperation','defaultEquivalentDeduplication','backgroundSelectionAndFocusPreserved']:assert reloadApi['completed'][key],key
 assert reloadApi['completed']['rawGuestBefore']==reloadApi['completed']['rawGuestAfter'] and reloadApi['completed']['rendererErrors']==[]
 assert reloadApi['reopened']['persisted'] and reloadApi['reopened']['noReloadReplay'] and reloadApi['reopened']['requestCountBefore']==reloadApi['reopened']['requestCountAfter'] and reloadApi['reopened']['rendererErrors']==[]
 sourcesApi=json.loads((app/'browser-import-sources-api.json').read_text());assert [c['status'] for c in sourcesApi['calls']]==[200,400,401,200,200]
 assert sourcesApi['completed']['loginSources']=={'sources':[]}
 for key in ['sameOriginalLinuxKeychainFilter','selectionAndFocusPreserved','invalidInputAndUnauthorizedRejected']:assert sourcesApi['completed'][key],key
 assert sourcesApi['completed']['sourceFilesUnchanged']==sourcesApi['reopened']['sourceFilesUnchanged']
 assert sourcesApi['reopened']['sameOriginalLinuxKeychainFilter'] and sourcesApi['reopened']['selectionAndFocusPreserved'] and sourcesApi['reopened']['rendererErrors']==[]
 cookieApi=json.loads((app/'browser-cookie-import-api.json').read_text());cookieStatuses=[c['status'] for c in cookieApi['calls']];assert cookieStatuses==[200,200,409,400,400,400,400,401,200,200,200,200,200,200,200],cookieStatuses
 assert cookieApi['completed']['first']['result']=={'imported':0,'skipped':0,'keyUnavailable':False}
 assert cookieApi['completed']['keyUnavailable']['result']=={'imported':0,'skipped':0,'keyUnavailable':True}
 for key in ['noCookieValuesTransferred','backgroundSelectionAndFocusPreserved','noKeyInjection','cachedResultDespiteSourceChange']:assert cookieApi['completed'][key],key
 assert cookieApi['completed']['originalHashes']==cookieApi['reopened']['originalHashes']
 for key in ['noReimportOrReprobeDespiteAbsentSourceCookieDb','jarUnchanged','selectionAndFocusPreserved']:assert cookieApi['reopened'][key],key
 assert cookieApi['reopened']['rendererErrors']==[] and len(cookieApi['fixtureChanges'])==2
 assert len(nav['calls'])==12 and sum(c['code']==0 for c in nav['calls'])==9
 evalCli=json.loads((app/'browser-evaluation-cli.json').read_text())
 cliCodes=[c['code'] for c in evalCli['calls']]
 assert cliCodes==[0,0,0,1,1,0,0,0,0,0,1,0,1,0,1,0,0,0],cliCodes
 assert evalCli['originalUndefinedJsonOmissionPreserved']
 assert evalCli['completed']['oneEvaluationForRepeatedId'] and evalCli['completed']['failedEvaluationNotRetried'] and evalCli['completed']['backgroundTabAndFocusPreserved']
 assert evalCli['reopened']['noReplayOrRetarget']
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
 report['native'].append({'case':name,'browserOpenApi':opened,'browserReloadApi':reloadApi,'browserImportSourcesApi':sourcesApi,'browserCookieImportApi':cookieApi,'browserOpenCli':openCli,'evaluationCliExitCodes':cliCodes,'evaluationCliCompleted':evalCli['completed'],'evaluationCliReopened':evalCli['reopened'],'originalUndefinedJsonOmissionPreserved':True,'evaluationApiStatuses':statuses,'evaluationCompleted':evalReport['completed'],'evaluationReopened':evalReport['reopened'],'undefinedResultPreserved':True,'cliExitCodes':[c['code'] for c in nav['calls']],'cliCompleted':nav['completed'],'cliReopened':nav['reopened'],'rawCliGuestNavigationEvents':events,'apiStatuses':[c['status'] for c in api['calls']],'readCaptureExitCodes':[c['code'] for c in read['calls']],'samePty':True,'sameExecution':True,'sameCwd':True,'ownedPids':pids,'cleanup':cleanup})
report['sourceCliFilesVerified']=len(sourceCli)
report['postNativeDocumentationChanges']=sourceChanges
report['fixtureSource']=json.loads((out/'fixture-source.json').read_text())
(out/'final-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'compiledFiles':len(product['files']),'fixtures':len(fixtures),'nativeCases':len(report['native']),'allPassed':True}))
