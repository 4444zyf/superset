from pathlib import Path
r=Path('/workspace/superset');src=r/'apps/desktop/src';d=src/'renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/SignedInSitesSubmenu';p=d/'SignedInSitesSubmenu.tsx';old=p.read_text();v=d/'components/SignedInSitesSubmenuView';v.mkdir(parents=True);s=old.replace('import { useMemo, useState } from "react";','import { useMemo, useState, useRef, useEffect, useCallback } from "react";').replace('import { electronTrpcClient } from "renderer/lib/trpc-client";','import type { BrowserCookieDomain, BrowserSiteCookiesApi } from "shared/browser-site-cookies";');a=s.index('interface CookieDomain {');b=s.index('\n\n/**',a);s=s[:a]+s[b:];s=s.replace('export function SignedInSitesSubmenu() {','export function SignedInSitesSubmenuView({ source }: { source: BrowserSiteCookiesApi }) {');a=s.index('\tconst [domains, setDomains]');b=s.index('\n\tconst matches = useMemo',a);s=s[:a]+'''
 const [loaded, setLoaded] = useState<{source:BrowserSiteCookiesApi; domains:BrowserCookieDomain[]}|null>(null);
 const domains = loaded?.source === source ? loaded.domains : null;
 const [failedSource, setFailedSource] = useState<BrowserSiteCookiesApi|null>(null);
 const [query, setQuery] = useState("");
 const [isOpen, setIsOpen] = useState(false);
 const [busy, setBusy] = useState(false);
 const revision=useRef(0);
 const loadDomains=useCallback(()=>{
  const token=++revision.current;
  setLoaded(null);setFailedSource(null);setBusy(false);
  void source.getDomains().then(domains=>{if(revision.current===token)setLoaded({source,domains});}).catch(()=>{if(revision.current===token)setFailedSource(source);});
 },[source]);
 useEffect(()=>{
  if(isOpen)loadDomains();
  return ()=>{revision.current++;};
 },[isOpen,loadDomains]);
 const handleForget=(domain:string)=>{
  if(busy)return;
  const token=revision.current;
  setBusy(true);
  void source.forget({domain}).then(result=>{
   if(revision.current!==token)return;
   if(!result.success)throw Error("Could not forget site");
   loadDomains();
  }).catch(()=>{
   if(revision.current!==token)return;
   setBusy(false);
   toast.error(t({message:`Could not forget ${domain}`}));
  });
 };
'''+s[b:];s=s.replace('onOpenChange={(open) => {\n\t\t\t\tif (open) loadDomains();\n\t\t\t\telse setQuery("");\n\t\t\t}}','open={isOpen}\n onOpenChange={(open) => { setIsOpen(open); if(!open)setQuery(""); }}');s=s.replace('{domains === null ? (','''{failedSource === source ? (
 <>
 <div role="alert" className="px-2 py-1.5 text-sm text-destructive"><Trans>An error occurred</Trans></div>
 <DropdownMenuItem onSelect={event=>{event.preventDefault();loadDomains();}}><Trans>Retry</Trans></DropdownMenuItem>
 </>
 ) : domains === null ? (''');s=s.replace('key={domain}','key={domain}\n disabled={busy}');(v/'SignedInSitesSubmenuView.tsx').write_text(s);(v/'index.ts').write_text('export { SignedInSitesSubmenuView } from "./SignedInSitesSubmenuView";\n');p.write_text('''import { electronTrpcClient } from "renderer/lib/trpc-client";
import { SignedInSitesSubmenuView } from "./components/SignedInSitesSubmenuView";
const source = {
 getDomains: () => electronTrpcClient.browser.getCookieDomains.query(),
 forget: (input:{domain:string}) => electronTrpcClient.browser.clearCookiesForDomain.mutate(input),
};
export function SignedInSitesSubmenu() {
 return <SignedInSitesSubmenuView source={source} />;
}
''')
p=src/'shared/workstation-browser.ts';s=p.read_text();s='import type { BrowserSiteCookiesApi } from "./browser-site-cookies";\n'+s;s=s.replace('export interface WorkstationBrowserApi {','export interface WorkstationBrowserApi {\n siteCookies?: BrowserSiteCookiesApi;');p.write_text(s)
p=src/'preload/index.ts';s=p.read_text().replace('clearData: (input) => invoke("clearBrowserData", input),','''clearData: (input) => invoke("clearBrowserData", input),
 siteCookies: {
 getDomains: () => invoke("getBrowserCookieDomains"),
 forget: (input) => invoke("forgetBrowserCookieDomain",input),
 },''');p.write_text(s)
p=src/'main/direct-app.ts';s=p.read_text();s='''import { createBrowserSiteCookies } from "./lib/browser/browser-site-cookies";
import { currentBrowserCookies } from "./lib/browser/current-browser-cookies";
'''+s;s=s.replace('switch (action) {','''switch (action) {
 case "getBrowserCookieDomains":
 case "forgetBrowserCookieDomain": {
  const siteCookies = createBrowserSiteCookies(currentBrowserCookies(
   () => session.fromPartition("persist:superset").cookies,
   () => window === callerWindow && rendererOwnerEpoch === callerEpoch && !callerWindow.isDestroyed(),
  ));
  if(action === "getBrowserCookieDomains") return siteCookies.getDomains();
  const input=z.strictObject({domain:z.string().min(1).max(253)}).parse(payload);
  return siteCookies.forget(input);
 }''',1);p.write_text(s)
p=src/'renderer/workstation/Workstation/components/WorkspaceWindow/components/WorkspaceBrowserPane/WorkspaceBrowserPane.tsx';s=p.read_text();s='import { SignedInSitesSubmenuView } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/SignedInSitesSubmenu/components/SignedInSitesSubmenuView";\n'+s;s=s.replace('onImport={\n','signedInSites={api.browser?.siteCookies ? <SignedInSitesSubmenuView source={api.browser.siteCookies} /> : undefined}\n onImport={\n',1);p.write_text(s)
