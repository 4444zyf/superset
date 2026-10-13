import { afterEach, expect, test } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { PaneTreeView } from "./PaneTreeView";
afterEach(cleanup);
test("ending a drag before the next render commits the final pointer ratio", () => {
	const changes: [number, boolean][] = [];
	const view = render(
		<PaneTreeView
			tree={{
				type: "split",
				axis: "horizontal",
				ratio: 0.5,
				first: { type: "pane", paneId: "a" },
				second: { type: "pane", paneId: "b" },
			}}
			renderPane={(id) => <span>{id}</span>}
			onRatio={(_path, ratio, final) => changes.push([ratio, final])}
		/>,
	);
	const parent = view.container.querySelector(".ws-pane-split")!;
	parent.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect;
	const separator = screen.getByRole("separator");
	Object.assign(separator, {
		setPointerCapture: () => {},
		hasPointerCapture: () => false,
	});
	act(() => {
		fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500 });
		fireEvent.pointerMove(separator, { pointerId: 1, clientX: 370 });
		fireEvent.pointerUp(separator, { pointerId: 1, clientX: 370 });
	});
	expect(changes.at(-1)).toEqual([0.37, true]);
});
