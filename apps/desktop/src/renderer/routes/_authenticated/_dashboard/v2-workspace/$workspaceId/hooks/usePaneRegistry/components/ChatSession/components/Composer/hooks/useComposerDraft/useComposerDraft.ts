import { useCallback, useEffect, useMemo, useState } from "react";
import { ComposerDraftWriter } from "renderer/lib/composer-draft-writer/composer-draft-writer";

const unsavedDrafts = new Map<string, string>();
const recoveredAfterRead = new Map<string, string[]>();

function persistDraft(draftKey: string, text: string): boolean {
	try {
		if (text === "") window.localStorage.removeItem(draftKey);
		else window.localStorage.setItem(draftKey, text);
		return true;
	} catch (error) {
		console.warn("[chat] could not save the composer draft", error);
		return false;
	}
}

function readDraft(draftKey: string): string | undefined {
	const unsaved = unsavedDrafts.get(draftKey);
	if (unsaved !== undefined) return unsaved;
	try {
		return window.localStorage.getItem(draftKey) ?? undefined;
	} catch {
		return undefined;
	}
}

export function prependToDraft(draftKey: string, text: string) {
	const current = readDraft(draftKey);
	const merged = current ? `${text}\n\n${current}` : text;
	unsavedDrafts.set(draftKey, merged);
	persistDraft(draftKey, merged);
	recoveredAfterRead.set(draftKey, [
		...(recoveredAfterRead.get(draftKey) ?? []),
		text,
	]);
}

export function takeRecoveredDraftText(draftKey: string): string | null {
	const recovered = recoveredAfterRead.get(draftKey);
	recoveredAfterRead.delete(draftKey);
	return recovered?.length ? recovered.join("\n\n") : null;
}

export function useComposerDraft(draftKey: string) {
	const writer = useMemo(
		() => new ComposerDraftWriter(unsavedDrafts, persistDraft),
		[],
	);
	const flushDraft = useCallback(() => {
		void writer.flush();
	}, [writer]);
	const onChange = useCallback(
		(text: string) => writer.change(draftKey, text),
		[draftKey, writer],
	);

	useEffect(() => flushDraft, [flushDraft]);

	const [seed, setSeed] = useState(() => {
		recoveredAfterRead.delete(draftKey);
		return { draftKey, text: readDraft(draftKey) };
	});

	const clearDraft = useCallback(() => {
		writer.cancel();
		unsavedDrafts.delete(draftKey);
		persistDraft(draftKey, "");
		setSeed({ draftKey, text: undefined });
	}, [draftKey, writer]);

	const storedDraft =
		seed.draftKey === draftKey ? seed.text : readDraft(draftKey);

	return { storedDraft, onChange, clearDraft };
}
