from pathlib import Path
r=Path('/workspace/superset/apps/desktop/scripts');p=r/'verify-brand-ui.mjs';s=p.read_text();needle='\n\t\t\t\tsetClipboard: async (value) =>';i=s.index(needle);block='''
 prepareBrowserSiteCookies: async (primaryHost) => {
  assert.ok(process.argv.includes("--browser-sites"));
  return main.evaluate(`(async()=>{const e=${electron};if(process.pid!==${child.pid}||e.app.getPath('appData')!==${JSON.stringify(join(output,'../config'))})throw Error('Wrong owned cookie fixture profile');const cookies=e.session.fromPartition('persist:superset').cookies;const before=await cookies.get({});if(before.filter(c=>c.name.startsWith('owned_cookie_')).length!==2)throw Error('Unexpected owned primary cookies');for(const domain of ['other-owned.invalid',...Array.from({length:25},(_,i)=>'site-'+String(i).padStart(2,'0')+'-owned.invalid')])await cookies.set({url:'https://'+domain+'/protected',name:'owned_cookie_other',value:'owned-fixture',path:'/protected',secure:true,httpOnly:true,expirationDate:Date.now()/1000+3600});const rows=await cookies.get({});return {cookieCount:rows.length,primaryCount:rows.filter(c=>c.domain===${JSON.stringify(primaryHost)}).length,foreignCount:rows.filter(c=>c.domain==='other-owned.invalid').length};})()`);
 },
 readBrowserSiteCookies: async () => {
  assert.ok(process.argv.includes("--browser-sites"));
  return main.evaluate(`(async()=>{const e=${electron};if(process.pid!==${child.pid}||e.app.getPath('appData')!==${JSON.stringify(join(output,'../config'))})throw Error('Wrong owned cookie fixture profile');return (await e.session.fromPartition('persist:superset').cookies.get({})).map(c=>({domain:c.domain,path:c.path,name:c.name,secure:c.secure,httpOnly:c.httpOnly}));})()`);
 },
''';s=s[:i]+block+s[i:];p.write_text(s)
p=r/'verify-workstation-browser-ui.mjs';s=p.read_text();needle='\n\t\tif (process.argv.includes("--browser-import-banner")) {';i=s.index(needle,s.index('report.tools ='));s=s[:i]+'''
 if (process.argv.includes("--browser-sites")) {
 const { verifyWorkstationBrowserSitesUi } = await import("./verify-workstation-browser-sites-ui.mjs");
 report.sites = await verifyWorkstationBrowserSitesUi(options,{guestRead,key});
 save();
 }
'''+s[i:];i=s.index(needle,s.index('report.sites ='));s=s[:i]+s[i:];i=s.index(needle,s.index('report.rendererAfterReopen')) if 'report.rendererAfterReopen' in s else s.index(needle,s.index('report.afterReopen'));s=s[:i]+'''
 if (process.argv.includes("--browser-sites")) {
 const { verifyWorkstationBrowserSitesReopened } = await import("./verify-workstation-browser-sites-ui.mjs");
 report.sitesReopened = await verifyWorkstationBrowserSitesReopened(options,report.sites);
 save();
 }
'''+s[i:];p.write_text(s)
p=Path('/workspace/scratch/parity-91/browser-sites-native.py');s=Path('/workspace/scratch/parity-89/browser-import-settings-native.py').read_text().replace('parity-89','parity-91').replace('parity89-','parity91-').replace("'--browser-import-settings'","'--browser-sites'");p.write_text(s)
p=Path('/workspace/scratch/parity-91/snapshot.py');s=Path('/workspace/scratch/parity-90/snapshot.py').read_text().replace('parity-90','parity-91');p.write_text(s)
