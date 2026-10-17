import { Trans, useLingui } from "@lingui/react/macro";
import { type CSSProperties, useEffect, useState } from "react";
import { getBaseName } from "renderer/lib/pathBasename";
import { getImageMimeType } from "shared/file-types";
import type { ViewProps } from "../../types";
import { usePanZoom } from "./hooks/usePanZoom";

const CHECKERBOARD =
	"conic-gradient(color-mix(in srgb, var(--color-foreground) 10%, transparent) 25%, transparent 0 50%, color-mix(in srgb, var(--color-foreground) 10%, transparent) 0 75%, transparent 0)";

export function ImageView({ document, filePath, embedded }: ViewProps) {
	const { t } = useLingui();
	const [source, setSource] = useState<{ key: string; url: string } | null>(
		null,
	);
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const sourceKey =
		document.content.kind === "bytes"
			? JSON.stringify([document.id, filePath, document.content.revision])
			: null;
	const objectUrl = source?.key === sourceKey ? source?.url : null;
	const failed = objectUrl != null && objectUrl === failedUrl;
	const {
		containerRef,
		transform,
		isDragging,
		isTransformed,
		reset,
		handlers,
	} = usePanZoom();

	useEffect(() => {
		reset();
		if (document.content.kind !== "bytes") {
			setSource(null);
			return;
		}
		const mimeType = getImageMimeType(filePath) ?? "image/png";
		const url = URL.createObjectURL(
			new Blob([document.content.value as BlobPart], { type: mimeType }),
		);
		setSource({
			key: JSON.stringify([document.id, filePath, document.content.revision]),
			url,
		});
		setFailedUrl(null);
		return () => URL.revokeObjectURL(url);
	}, [document.id, document.content, filePath, reset]);

	if (embedded) {
		return (
			<div className="flex h-full items-center justify-center bg-background p-4">
				{failed ? (
					<p role="alert">
						<Trans>Failed to load image</Trans>
					</p>
				) : (
					objectUrl && (
						<CheckerboardImage
							src={objectUrl}
							filePath={filePath}
							onError={() => setFailedUrl(objectUrl)}
						/>
					)
				)}
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			role="application"
			aria-label={t({
				message: `Image preview of ${getBaseName(filePath)}. Zoom with plus and minus, pan with arrow keys, press 0 to reset.`,
			})}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: focus is required for the keyboard pan/zoom handlers
			tabIndex={0}
			className={`relative flex h-full touch-none items-center justify-center overflow-hidden bg-background p-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
				isDragging ? "cursor-grabbing" : "cursor-grab"
			}`}
			{...handlers}
		>
			{failed && (
				<p role="alert">
					<Trans>Failed to load image</Trans>
				</p>
			)}
			{objectUrl && !failed && (
				<CheckerboardImage
					src={objectUrl}
					filePath={filePath}
					onError={() => setFailedUrl(objectUrl)}
					style={{
						transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
					}}
				/>
			)}
			{isTransformed && (
				<button
					type="button"
					className="absolute right-2 bottom-2 rounded-md border border-border bg-background/80 px-2 py-0.5 font-mono text-muted-foreground text-xs backdrop-blur hover:text-foreground"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={reset}
					title={t({
						message: "Reset zoom",
					})}
				>
					{Math.round(transform.scale * 100)}%
				</button>
			)}
		</div>
	);
}

function CheckerboardImage({
	src,
	filePath,
	style,
	onError,
}: {
	src: string;
	filePath: string;
	style?: CSSProperties;
	onError?(): void;
}) {
	return (
		<div
			className="flex h-full w-full items-center justify-center"
			style={style}
		>
			<img
				src={src}
				alt={getBaseName(filePath)}
				className="block max-h-full max-w-full select-none object-contain"
				style={{ backgroundImage: CHECKERBOARD, backgroundSize: "16px 16px" }}
				draggable={false}
				onError={onError}
			/>
		</div>
	);
}
