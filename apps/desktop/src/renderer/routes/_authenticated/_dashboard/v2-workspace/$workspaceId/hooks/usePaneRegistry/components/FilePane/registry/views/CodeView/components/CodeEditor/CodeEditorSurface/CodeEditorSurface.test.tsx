import { afterEach, expect, mock, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import { darkTheme } from "@superset/shared/themes";
import { act, cleanup, render } from "@testing-library/react";
import { CodeEditorSurface } from "./CodeEditorSurface";

afterEach(cleanup);

test("line-only navigation keeps its original selection and position requests repeat without editing the document", () => {
	const onChange = mock();
	const props = {
		theme: darkTheme,
		value: "one\ntwo\nthree 中文\nfour",
		language: "plaintext",
		onChange,
	};
	const rendered = render(<CodeEditorSurface {...props} revealLine={3} />);
	const element = rendered.container.querySelector<HTMLElement>(".cm-editor");
	if (!element) throw new Error("Editor missing");
	const view = EditorView.findFromDOM(element);
	if (!view) throw new Error("Editor view missing");
	expect(view.state.selection.main.head).toBe(8);
	rendered.rerender(
		<CodeEditorSurface {...props} revealPosition={{ line: 3, column: 2 }} />,
	);
	expect(view.state.selection.main.head).toBe(9);
	act(() => view.dispatch({ selection: { anchor: 0 } }));
	rendered.rerender(
		<CodeEditorSurface {...props} revealPosition={{ line: 3, column: 2 }} />,
	);
	expect(view.state.selection.main.head).toBe(9);
	for (const [line, column, expected] of [
		[3, 1000, 16],
		[3, -1, 8],
		[3, 1.5, 8],
		[3, Number.NaN, 8],
		[1000, 1000, 21],
		[-1, 2, 1],
	] as const) {
		rendered.rerender(
			<CodeEditorSurface {...props} revealPosition={{ line, column }} />,
		);
		expect(view.state.selection.main.head).toBe(expected);
	}
	expect(view.state.doc.toString()).toBe(props.value);
	expect(onChange).not.toHaveBeenCalled();
});
