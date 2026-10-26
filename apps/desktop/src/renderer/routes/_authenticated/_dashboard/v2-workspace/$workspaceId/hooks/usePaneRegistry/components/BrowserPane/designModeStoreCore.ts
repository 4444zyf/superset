import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { useCallback, useSyncExternalStore } from "react";
import type {
	DesignModePayload,
	DesignModeRect,
	DesignModeScreenshot,
	DesignModeSelectionResult,
} from "shared/browser-design-mode";

export interface DesignModeClient {
	designModeSet: {
		mutate(input: {
			paneId: string;
			enabled: boolean;
		}): Promise<{ ok: boolean }>;
	};
	designModeAwaitSelection: {
		mutate(input: {
			paneId: string;
			opId: string;
		}): Promise<DesignModeSelectionResult>;
	};
	designModeScreenshot: {
		mutate(input: {
			paneId: string;
			rect: DesignModeRect;
		}): Promise<{ screenshot: DesignModeScreenshot | null }>;
	};
}

export type DesignModePhase = "idle" | "selecting" | "confirming";

export interface DesignModeState {
	phase: DesignModePhase;
	/** Set while `phase === "confirming"`. */
	payload: DesignModePayload | null;
}

const IDLE_STATE: DesignModeState = Object.freeze({
	phase: "idle" as const,
	payload: null,
});

/**
 * Per-pane design-mode lifecycle: idle → selecting (overlay armed in the
 * guest, awaiting a click) → confirming (composer shown over the pane) →
 * idle. Lives outside React because the toolbar toggle and the pane body are
 * separate component trees that both need the same state, and the await runs
 * across renders.
 */
export class DesignModeStoreCore {
	constructor(
		private readonly client: DesignModeClient,
		private readonly notifyError: (
			message: string,
			options?: { description?: string },
		) => void,
	) {}

	private states = new Map<string, DesignModeState>();
	private listeners = new Map<string, Set<() => void>>();
	// Bumped on every start/cancel so an in-flight await whose world changed
	// (cancelled, re-toggled, pane switched) drops its result on the floor.
	private generations = new Map<string, number>();

	getState(paneId: string): DesignModeState {
		return this.states.get(paneId) ?? IDLE_STATE;
	}

	subscribe(paneId: string, listener: () => void): () => void {
		let set = this.listeners.get(paneId);
		if (!set) {
			set = new Set();
			this.listeners.set(paneId, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	private setState(paneId: string, state: DesignModeState): void {
		if (state.phase === "idle") {
			this.states.delete(paneId);
		} else {
			this.states.set(paneId, state);
		}
		const listeners = this.listeners.get(paneId);
		if (!listeners) return;
		for (const listener of listeners) listener();
	}

	private bumpGeneration(paneId: string): number {
		const next = (this.generations.get(paneId) ?? 0) + 1;
		this.generations.set(paneId, next);
		return next;
	}

	toggle(paneId: string): void {
		if (this.getState(paneId).phase === "idle") {
			void this.start(paneId);
		} else {
			this.exit(paneId);
		}
	}

	/** Discard the captured element and go back to picking: re-injects the
	 *  overlay (tearing down the frozen highlight) and awaits a new selection. */
	rearm(paneId: string): void {
		void this.start(paneId);
	}

	/** Leave design mode: cancel any in-flight selection, tear down the guest
	 *  overlay, and reset to idle. Safe to call in any phase. */
	exit(paneId: string): void {
		this.bumpGeneration(paneId);
		this.client.designModeSet
			.mutate({ paneId, enabled: false })
			.catch(() => {});
		this.setState(paneId, IDLE_STATE);
	}

	private async start(paneId: string): Promise<void> {
		const generation = this.bumpGeneration(paneId);
		const superseded = () => this.generations.get(paneId) !== generation;
		this.setState(paneId, { phase: "selecting", payload: null });

		let setResult: { ok: boolean };
		try {
			setResult = await this.client.designModeSet.mutate({
				paneId,
				enabled: true,
			});
		} catch {
			setResult = { ok: false };
		}
		if (superseded()) return;
		if (!setResult.ok) {
			this.notifyError(
				i18n._(
					msg({
						message: "Couldn't start design mode on this page",
					}),
				),
			);
			this.setState(paneId, IDLE_STATE);
			return;
		}

		const opId = `design-${generation}-${Date.now()}`;
		let result: Awaited<
			ReturnType<typeof this.client.designModeAwaitSelection.mutate>
		>;
		try {
			result = await this.client.designModeAwaitSelection.mutate({
				paneId,
				opId,
			});
		} catch (error) {
			if (superseded()) return;
			this.notifyError(
				i18n._(
					msg({
						message: "Design mode failed",
					}),
				),
				{
					description: error instanceof Error ? error.message : undefined,
				},
			);
			this.exit(paneId);
			return;
		}
		if (superseded()) return;

		if (result.kind === "selected") {
			// Element screenshot is best-effort; the DOM/CSS payload alone is
			// still worth sending.
			let screenshot: DesignModeScreenshot | null = null;
			try {
				const captured = await this.client.designModeScreenshot.mutate({
					paneId,
					rect: result.payload.target.rectViewport,
				});
				screenshot = captured.screenshot;
			} catch {}
			if (superseded()) return;
			this.setState(paneId, {
				phase: "confirming",
				payload: { ...result.payload, screenshot },
			});
			return;
		}

		if (result.kind === "error") {
			this.notifyError(
				i18n._(
					msg({
						message: "Design mode failed",
					}),
				),
				{ description: result.reason },
			);
		}
		this.setState(paneId, IDLE_STATE);
	}
}

export function useDesignModeStateCore(
	paneId: string,
	store: DesignModeStoreCore,
): DesignModeState {
	return useSyncExternalStore(
		useCallback((cb) => store.subscribe(paneId, cb), [paneId, store]),
		useCallback(() => store.getState(paneId), [paneId, store]),
	);
}
