from pathlib import Path
p=Path('/workspace/superset/apps/desktop/scripts/verify-workstation-browser-ui.mjs');s=p.read_text();needle='\n\t\tawait click("[data-workstation-new-browser]");';start=s.index(needle);s=s[:start]+'''
 if (process.argv.includes("--browser-import-banner")) {
 const { prepareBrowserImportBannerFixture } = await import("./verify-workstation-browser-import-banner-ui.mjs");
 prepareBrowserImportBannerFixture(options, `http://localhost:${proof.port}/preview?first=%E4%B8%AD#initial`);
 }
'''+s[start:];needle='\n\t\tif (process.argv.includes("--browser-import-settings")) {';start=s.index(needle);s=s[:start]+'''
 if (process.argv.includes("--browser-import-banner")) {
 const { verifyWorkstationBrowserImportBannerUi } = await import("./verify-workstation-browser-import-banner-ui.mjs");
 report.importBanner = await verifyWorkstationBrowserImportBannerUi(options);
 save();
 }
'''+s[start:];start=s.index(needle,s.index('report.importBanner ='));start=s.index(needle,start+len(needle));s=s[:start]+'''
 if (process.argv.includes("--browser-import-banner")) {
 const { verifyWorkstationBrowserImportBannerReopened } = await import("./verify-workstation-browser-import-banner-ui.mjs");
 report.importBannerReopened = await verifyWorkstationBrowserImportBannerReopened(options, report.importBanner);
 save();
 }
'''+s[start:];p.write_text(s)
p=Path('/workspace/scratch/parity-90/browser-import-banner-native.py');s=Path('/workspace/scratch/parity-89/browser-import-settings-native.py').read_text().replace('parity-89','parity-90').replace('parity89-','parity90-').replace("'--browser-import-settings'","'--browser-import-banner',*(['--banner-dismiss'] if '--ssh' in sys.argv else [])");p.write_text(s)
p=Path('/workspace/scratch/parity-90/snapshot.py');s=Path('/workspace/scratch/parity-89/snapshot.py').read_text().replace('parity-89','parity-90');p.write_text(s)
