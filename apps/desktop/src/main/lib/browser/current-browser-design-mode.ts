import type {
	DesignModeRect,
	DesignModeScreenshot,
	DesignModeSelectionResult,
} from "shared/browser-design-mode";

interface BrowserDesignModeManager {
	setDesignMode(paneId: string, enabled: boolean): Promise<boolean>;
	awaitDesignSelection(
		paneId: string,
		opId: string,
	): Promise<DesignModeSelectionResult>;
	captureDesignScreenshot(
		paneId: string,
		rect: DesignModeRect,
	): Promise<DesignModeScreenshot | null>;
}

export function currentBrowserDesignMode(
	manager: BrowserDesignModeManager,
	paneId: string,
	isCurrent: () => boolean,
) {
	const assertCurrent = () => {
		if (!isCurrent()) throw new Error("Browser pane is no longer current");
	};
	return {
		set: async (enabled: boolean) => {
			assertCurrent();
			const ok = await manager.setDesignMode(paneId, enabled);
			assertCurrent();
			return { ok };
		},
		awaitSelection: async (opId: string) => {
			assertCurrent();
			const result = await manager.awaitDesignSelection(paneId, opId);
			assertCurrent();
			return result;
		},
		screenshot: async (rect: DesignModeRect) => {
			assertCurrent();
			const screenshot = await manager.captureDesignScreenshot(paneId, rect);
			assertCurrent();
			return { screenshot };
		},
	};
}
