from pathlib import Path
r=Path('/workspace/superset/apps/desktop/scripts');p=r/'verify-workstation-browser-import-ui.mjs';s=p.read_text().replace('function prepareSourceFiles(', 'export function prepareSourceFiles(').replace('function sourceFilesUnchanged(', 'export function sourceFilesUnchanged(');p.write_text(s)
p=r/'verify-workstation-browser-ui.mjs';s=p.read_text();needle='\n\t\tif (process.argv.includes("--browser-import")) {';start=s.index(needle);block='''
 if (process.argv.includes("--browser-import-settings")) {
 const { verifyWorkstationBrowserImportSettingsUi } = await import("./verify-workstation-browser-import-settings-ui.mjs");
 report.importSettings = await verifyWorkstationBrowserImportSettingsUi(options, { url });
 save();
 }
''';s=s[:start]+block+s[start:];start=s.index(needle,s.index('report.importSettings =')+len('report.importSettings ='));start=s.index(needle,start+len(needle));block='''
 if (process.argv.includes("--browser-import-settings")) {
 const { verifyWorkstationBrowserImportReopened } = await import("./verify-workstation-browser-import-ui.mjs");
 report.importSettingsReopened = await verifyWorkstationBrowserImportReopened(options, report.importSettings);
 save();
 }
''';s=s[:start]+block+s[start:];p.write_text(s)
