from pathlib import Path
r=Path('/workspace/superset/apps/desktop/src/renderer/workstation/Workstation');p=r/'components/WorkspaceWindow/components/WorkspaceBrowserPane/WorkspaceBrowserPane.test.tsx';s=p.read_text().replace('revision: 0, screenshots: []','revision: 0, rows: []');p.write_text(s)
p=r/'components/WorkstationSettings/WorkstationSettings.test.tsx';s=p.read_text();s='''import { useState } from "react";
import { WorkstationBrowserImport } from "../../providers/WorkstationBrowserImport";
import type { BrowserImportApi } from "shared/browser-import";
import type { BrowserPreferencesState } from "../../hooks/useBrowserPreferences";
'''+s;s=s.replace('cleanup,','act,\n cleanup,',1);s+='''
const browserPreferences: BrowserPreferencesState = {
 available: true, loading: false, saving: true, error: null, snapshot: null,
 reload: async () => {}, update: async () => {}, reset: async () => {},
};
test("settings imports remain visible and protected while pending after the settings parent unmounts", async () => {
 let finish!: (value: { imported: number }) => void;
 let reads = 0, writes = 0;
 const source: BrowserImportApi = {
  getSources: async () => { reads++; return { needsFullDiskAccess: false, sources: [{id: "/owned/profile", browserKey: "chrome", browserName: "Chrome", profileName: "Owned"}] }; },
  importHistory: () => { writes++; return new Promise(resolve => { finish = resolve; }); },
  importCookies: async () => ({ imported: 0, skipped: 0, keyUnavailable: true }),
  requestFullDiskAccess: async () => {},
 };
 function Host() {
  const [settingsOpen, setSettingsOpen] = useState(true);
  return <WorkstationBrowserImport source={source}>
   {settingsOpen && <WorkstationSettings open onOpenChange={setSettingsOpen} snapshot={snapshot} saving={false} error={null} onUpdate={async () => {}} onReload={async () => {}} browserPreferences={browserPreferences} />}
  </WorkstationBrowserImport>;
 }
 render(<Host />);
 expect(reads).toBe(0);
 const open = screen.getByRole("button", { name: "Import…" });
 expect(open.hasAttribute("disabled")).toBe(false);
 await act(async () => fireEvent.click(open));
 expect(reads).toBe(1);
 expect(document.querySelectorAll("#import-history").length).toBe(1);
 expect(screen.getAllByRole("dialog").length).toBe(2);
 await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import", exact: true })));
 expect(writes).toBe(1);
 const parentClose = document.querySelector<HTMLElement>("[data-workstation-settings] [data-slot=dialog-close]");
 if (!parentClose) throw Error("Settings close missing");
 await act(async () => fireEvent.click(parentClose));
 expect(document.querySelector("[data-workstation-settings]")).toBeNull();
 expect(screen.getAllByRole("dialog").length).toBe(1);
 expect(screen.getByRole("button", { name: "Importing…" }).hasAttribute("disabled")).toBe(true);
 await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close", exact: true })));
 expect(screen.getAllByRole("dialog").length).toBe(1);
 await act(async () => finish({ imported: 1 }));
 expect(screen.queryByRole("dialog")).toBeNull();
 expect(writes).toBe(1);
});
test("settings omit the import action when the connected desktop does not expose import data", () => {
 render(<WorkstationBrowserImport><WorkstationSettings open onOpenChange={() => {}} snapshot={snapshot} saving={false} error={null} onUpdate={async () => {}} onReload={async () => {}} browserPreferences={browserPreferences} /></WorkstationBrowserImport>);
 expect(screen.queryByRole("button", { name: "Import…" })).toBeNull();
});
''';p.write_text(s)
