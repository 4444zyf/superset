import type {
	DesignModeRect,
	DesignModeScreenshot,
	DesignModeSelectionResult,
} from "./browser-design-mode";
import type { WorkstationBrowserPane } from "./workstation-browser";

export interface WorkstationBrowserDesignModeApi {
	set(input: {
		pane: WorkstationBrowserPane;
		enabled: boolean;
	}): Promise<{ ok: boolean }>;
	awaitSelection(input: {
		pane: WorkstationBrowserPane;
		opId: string;
	}): Promise<DesignModeSelectionResult>;
	screenshot(input: {
		pane: WorkstationBrowserPane;
		rect: DesignModeRect;
	}): Promise<{ screenshot: DesignModeScreenshot | null }>;
}
