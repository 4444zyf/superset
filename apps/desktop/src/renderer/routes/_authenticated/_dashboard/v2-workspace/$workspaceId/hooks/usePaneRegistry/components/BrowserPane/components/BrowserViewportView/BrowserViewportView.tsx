import type { Ref } from "react";
export function BrowserViewportView({
	deviceToolbar,
	deviceToolbarSize,
	placeholderRef,
}: {
	deviceToolbar: { isOpen: boolean };
	deviceToolbarSize: { width: number; height: number };
	placeholderRef: Ref<HTMLDivElement>;
}) {
	return (
		<div
			style={
				deviceToolbar.isOpen
					? { alignItems: "safe center", justifyContent: "safe center" }
					: undefined
			}
			className={
				deviceToolbar.isOpen
					? "flex min-h-0 w-full flex-1 items-center justify-center overflow-auto bg-muted/20"
					: "min-h-0 w-full flex-1"
			}
		>
			<div
				ref={placeholderRef}
				style={
					deviceToolbar.isOpen
						? {
								width: deviceToolbarSize.width,
								height: deviceToolbarSize.height,
							}
						: undefined
				}
				className={
					deviceToolbar.isOpen ? "shrink-0 shadow-lg" : "h-full w-full"
				}
			/>
		</div>
	);
}
