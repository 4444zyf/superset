import { useLingui } from "@lingui/react/macro";
import { useRef, type ReactNode } from "react";
import type { PaneTree } from "../../../../../../../shared/workspace-view";

export function PaneTreeView({
	tree,
	path = [],
	renderPane,
	onRatio,
}: {
	tree: PaneTree;
	path?: ("first" | "second")[];
	renderPane(id: string): ReactNode;
	onRatio(path: ("first" | "second")[], ratio: number, final: boolean): void;
}) {
	const { t } = useLingui();
	const element = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const lastRatio = useRef(tree.type === "split" ? tree.ratio : 0.5);
	if (tree.type === "pane") return <>{renderPane(tree.paneId)}</>;
	const horizontal = tree.axis === "horizontal";
	return (
		<div
			ref={element}
			className={`ws-pane-split ${horizontal ? "horizontal" : "vertical"}`}
			data-split-path={path.join("/")}
			data-ratio={tree.ratio}
		>
			<div className="ws-split-child" style={{ flex: `${tree.ratio} 1 0%` }}>
				<PaneTreeView
					tree={tree.first}
					path={[...path, "first"]}
					renderPane={renderPane}
					onRatio={onRatio}
				/>
			</div>
			<div
				className="ws-pane-separator"
				role="separator"
				tabIndex={0}
				aria-label={t({ message: "Resize split" })}
				aria-orientation={horizontal ? "vertical" : "horizontal"}
				aria-valuemin={10}
				aria-valuemax={90}
				aria-valuenow={Math.round(tree.ratio * 100)}
				onPointerDown={(event) => {
					lastRatio.current = tree.ratio;
					dragging.current = true;
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					if (!dragging.current) return;
					const rect = element.current?.getBoundingClientRect();
					if (!rect) return;
					const size = horizontal ? rect.width : rect.height;
					if (size > 0) {
						lastRatio.current = Math.max(
							0.1,
							Math.min(
								0.9,
								(horizontal
									? event.clientX - rect.left
									: event.clientY - rect.top) / size,
							),
						);
						onRatio(path, lastRatio.current, false);
					}
				}}
				onPointerUp={(event) => {
					if (!dragging.current) return;
					dragging.current = false;
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						event.currentTarget.releasePointerCapture(event.pointerId);
					onRatio(path, lastRatio.current, true);
				}}
				onPointerCancel={() => {
					if (dragging.current) {
						dragging.current = false;
						onRatio(path, lastRatio.current, true);
					}
				}}
				onKeyDown={(event) => {
					const delta = horizontal
						? event.key === "ArrowRight"
							? 0.05
							: event.key === "ArrowLeft"
								? -0.05
								: 0
						: event.key === "ArrowDown"
							? 0.05
							: event.key === "ArrowUp"
								? -0.05
								: 0;
					if (delta) {
						event.preventDefault();
						onRatio(path, tree.ratio + delta, true);
					}
				}}
			/>
			<div
				className="ws-split-child"
				style={{ flex: `${1 - tree.ratio} 1 0%` }}
			>
				<PaneTreeView
					tree={tree.second}
					path={[...path, "second"]}
					renderPane={renderPane}
					onRatio={onRatio}
				/>
			</div>
		</div>
	);
}
