from pathlib import Path
r=Path('/workspace/superset');p=next(r.glob('apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/*/hooks/usePaneRegistry/components/BrowserPane'))
(p/'designModeStoreCore.test.ts').write_text('''import { expect, test } from "bun:test";
import type { DesignModePayload, DesignModeScreenshot, DesignModeSelectionResult } from "shared/browser-design-mode";
import { DesignModeStoreCore, type DesignModeClient } from "./designModeStoreCore";

function deferred<T>() {
 let resolve!: (value: T) => void;
 let reject!: (reason: unknown) => void;
 const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
 return { promise, resolve, reject };
}
async function drain() {
 await Promise.resolve();
 await Promise.resolve();
 await Promise.resolve();
 await Promise.resolve();
}
function payload(selector = "#owned"): DesignModePayload {
 return {
  page: { sanitizedUrl: "http://localhost/owned", title: "Owned", viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  target: { tagName: "button", selector, elementPath: selector, cssClasses: "", reactComponents: null, reactProps: null, sourceFile: null, textSnippet: "Owned", htmlSnippet: "<button>Owned</button>", attributes: {}, accessibility: { role: "button", accessibleName: "Owned", ariaLabel: null }, rectViewport: { x: 10, y: 20, width: 100, height: 32 }, rectPage: { x: 10, y: 20, width: 100, height: 32 }, computedStyles: { display: "block", position: "static", width: "100px", height: "32px", margin: "0px", padding: "0px", color: "black", backgroundColor: "white", border: "none", borderRadius: "0px", fontFamily: "sans-serif", fontSize: "12px", fontWeight: "400", lineHeight: "normal", textAlign: "start", zIndex: "auto" } },
  nearbyText: [], ancestorPath: [], screenshot: null,
 };
}
function fixture() {
 const enable = deferred<{ok: boolean}>();
 const selection = deferred<DesignModeSelectionResult>();
 const screenshot = deferred<{ screenshot: DesignModeScreenshot | null }>();
 const sets: {paneId: string; enabled: boolean}[] = [];
 const awaits: {paneId: string; opId: string}[] = [];
 const captures: unknown[] = [];
 const errors: {message: string; description?: string}[] = [];
 const client: DesignModeClient = {
  designModeSet: { mutate: async (input) => { sets.push(input); return input.enabled ? enable.promise : {ok: true}; } },
  designModeAwaitSelection: { mutate: async (input) => { awaits.push(input); return selection.promise; } },
  designModeScreenshot: { mutate: async (input) => { captures.push(input); return screenshot.promise; } },
 };
 const store = new DesignModeStoreCore(client, (message, options) => errors.push({message, ...options}));
 return {store, client, enable, selection, screenshot, sets, awaits, captures, errors};
}

test("selection preserves DOM context and attaches the matching element screenshot", async () => {
 const f = fixture(); const original = payload();
 const image: DesignModeScreenshot = {mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", width: 100, height: 32};
 f.store.toggle("pane"); expect(f.store.getState("pane").phase).toBe("selecting");
 f.enable.resolve({ok: true}); await drain(); expect(f.awaits[0].paneId).toBe("pane");
 f.selection.resolve({kind: "selected", opId: f.awaits[0].opId, payload: original}); await drain();
 expect(f.captures).toEqual([{paneId: "pane", rect: original.target.rectViewport}]);
 f.screenshot.resolve({screenshot: image}); await drain();
 expect(f.store.getState("pane")).toEqual({phase: "confirming", payload: {...original, screenshot: image}});
 expect(original.screenshot).toBeNull(); expect(f.errors).toEqual([]);
});

test("exit during arming ignores its late success and does not await a selection", async () => {
 const f = fixture(); f.store.toggle("pane"); f.store.exit("pane");
 f.enable.resolve({ok: true}); await drain();
 expect(f.store.getState("pane")).toEqual({phase: "idle", payload: null});
 expect(f.awaits).toEqual([]); expect(f.sets).toEqual([{paneId: "pane", enabled: true},{paneId: "pane", enabled: false}]);
});

test("a rearmed picker ignores the prior selection without capturing its screenshot", async () => {
 const f = fixture(); const next = deferred<DesignModeSelectionResult>();
 f.store.toggle("pane"); f.enable.resolve({ok: true}); await drain();
 f.client.designModeAwaitSelection.mutate = async (input) => { f.awaits.push(input); return next.promise; };
 f.store.rearm("pane"); await drain();
 expect(f.awaits[0].opId).not.toBe(f.awaits[1].opId);
 f.selection.resolve({kind: "selected", opId: f.awaits[0].opId, payload: payload("#old")}); await drain();
 expect(f.store.getState("pane").phase).toBe("selecting"); expect(f.captures).toEqual([]);
 next.resolve({kind: "selected", opId: f.awaits[1].opId, payload: payload("#new")}); f.screenshot.resolve({screenshot: null}); await drain();
 expect(f.store.getState("pane").payload?.target.selector).toBe("#new");
});

test("exit while a screenshot is pending prevents a late confirmation", async () => {
 const f = fixture(); f.store.toggle("pane"); f.enable.resolve({ok: true}); await drain();
 f.selection.resolve({kind: "selected", opId: f.awaits[0].opId, payload: payload()}); await drain();
 expect(f.captures).toHaveLength(1); f.store.exit("pane"); f.screenshot.resolve({screenshot: null}); await drain();
 expect(f.store.getState("pane").phase).toBe("idle"); expect(f.errors).toEqual([]);
});

test("a failed screenshot still offers the selected DOM context", async () => {
 const f = fixture(); f.store.toggle("pane"); f.enable.resolve({ok: true}); await drain();
 f.selection.resolve({kind: "selected", opId: f.awaits[0].opId, payload: payload()}); await drain();
 f.screenshot.reject(new Error("capture unavailable")); await drain();
 expect(f.store.getState("pane")).toEqual({phase: "confirming", payload: payload()}); expect(f.errors).toEqual([]);
});

test("arming rejection returns to idle with the original start failure", async () => {
 const f = fixture(); f.store.toggle("pane"); f.enable.reject(new Error("arm unavailable")); await drain();
 expect(f.store.getState("pane").phase).toBe("idle"); expect(f.awaits).toEqual([]);
 expect(f.errors).toEqual([{message: "Couldn't start design mode on this page"}]);
});

test("selection transport failure disarms the picker and keeps the original error detail", async () => {
 const f = fixture(); f.store.toggle("pane"); f.enable.resolve({ok: true}); await drain();
 f.selection.reject(new Error("selection unavailable")); await drain();
 expect(f.store.getState("pane").phase).toBe("idle"); expect(f.sets.at(-1)).toEqual({paneId: "pane", enabled: false});
 expect(f.errors).toEqual([{message: "Design mode failed", description: "selection unavailable"}]);
});

test("a cancelled selection returns only its owning pane to idle", async () => {
 const f = fixture(); const second = deferred<DesignModeSelectionResult>();
 f.store.toggle("first"); f.enable.resolve({ok: true}); await drain();
 f.client.designModeAwaitSelection.mutate = async () => second.promise;
 f.store.toggle("second"); await drain();
 f.selection.resolve({kind: "cancelled", opId: f.awaits[0].opId, reason: "navigation"}); await drain();
 expect(f.store.getState("first").phase).toBe("idle"); expect(f.store.getState("second").phase).toBe("selecting"); expect(f.errors).toEqual([]);
});

test("unsubscribe stops observing later changes on the same pane", () => {
 const f = fixture(); let first = 0, second = 0;
 const off = f.store.subscribe("first", () => first++); f.store.subscribe("second", () => second++);
 f.store.toggle("first"); expect(first).toBe(1); expect(second).toBe(0); off();
 f.store.exit("first"); expect(first).toBe(1); expect(second).toBe(0);
});
''')
