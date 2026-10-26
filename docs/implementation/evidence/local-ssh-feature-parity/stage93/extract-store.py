from pathlib import Path
r=Path('/workspace/superset');p=next(r.glob('apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/*/hooks/usePaneRegistry/components/BrowserPane'));s=(p/'designModeStore.ts').read_text()
s=s.replace('import { toast } from "@superset/ui/sonner";\n','').replace('import { electronTrpcClient } from "renderer/lib/trpc-client";\n','').replace('\tDesignModePayload,','\tDesignModePayload,\n\tDesignModeRect,\n\tDesignModeSelectionResult,',1)
s=s.replace('export type DesignModePhase', '''export interface DesignModeClient {
 designModeSet: {
  mutate(input: { paneId: string; enabled: boolean }): Promise<{ ok: boolean }>;
 };
 designModeAwaitSelection: {
  mutate(input: { paneId: string; opId: string }): Promise<DesignModeSelectionResult>;
 };
 designModeScreenshot: {
  mutate(input: { paneId: string; rect: DesignModeRect }): Promise<{ screenshot: DesignModeScreenshot | null }>;
 };
}

export type DesignModePhase''',1)
s=s.replace('class DesignModeStoreImpl {','''export class DesignModeStoreCore {
 constructor(
  private readonly client: DesignModeClient,
  private readonly notifyError: (message: string, options?: { description?: string }) => void,
 ) {}
''',1).replace('electronTrpcClient.browser','this.client').replace('toast.error(','this.notifyError(')
s=s.replace('export const designModeStore = new DesignModeStoreImpl();\n\n','')
s=s.replace('export function useDesignModeState(paneId: string): DesignModeState {','export function useDesignModeStateCore(paneId: string, store: DesignModeStoreCore): DesignModeState {').replace('designModeStore.subscribe','store.subscribe').replace('designModeStore.getState','store.getState').replace('[paneId]','[paneId, store]')
(p/'designModeStoreCore.ts').write_text(s)
(p/'designModeStore.ts').write_text('''import { toast } from "@superset/ui/sonner";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
 DesignModeStoreCore,
 type DesignModeState,
 useDesignModeStateCore,
} from "./designModeStoreCore";

export type { DesignModePhase, DesignModeState } from "./designModeStoreCore";

export const designModeStore = new DesignModeStoreCore(
 electronTrpcClient.browser,
 toast.error,
);

export function useDesignModeState(paneId: string): DesignModeState {
 return useDesignModeStateCore(paneId, designModeStore);
}
''')
