import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function pdfFixture() {
	const stream =
		"BT /F1 22 Tf 30 180 Td (Superset Remix SSH PDF) Tj 0 -36 Td /F1 14 Tf (Selected remote workspace) Tj ET\n";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let data = "%PDF-1.4\n";
	const offsets = [0];
	for (let i = 0; i < objects.length; i++) {
		offsets.push(Buffer.byteLength(data));
		data += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}
	const xref = Buffer.byteLength(data);
	data +=
		`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
		offsets
			.slice(1)
			.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
			.join("");
	data += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(data);
}
export function writeMediaFixtures(directory) {
	writeFileSync(join(directory, "report.pdf"), pdfFixture(), { flag: "wx" });
	const input = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-n",
		"-f",
		"lavfi",
		"-i",
		"testsrc2=size=320x180:rate=4:duration=6",
		"-an",
		"-threads",
		"1",
	];
	execFileSync(
		"ffmpeg",
		[
			...input,
			"-c:v",
			"libvpx-vp9",
			"-deadline",
			"realtime",
			"-cpu-used",
			"8",
			"-b:v",
			"180k",
			join(directory, "clip.webm"),
		],
		{ stdio: "pipe" },
	);
	execFileSync(
		"ffmpeg",
		[
			...input,
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-crf",
			"35",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			join(directory, "clip.mp4"),
		],
		{ stdio: "pipe" },
	);
	writeFileSync(
		join(directory, "oversized-clip.webm"),
		Buffer.alloc(1024 * 1024 + 1),
		{ flag: "wx" },
	);
	const record = (name) => {
		const data = readFileSync(join(directory, name));
		if (data.length > 1024 * 1024) throw new Error("Test media is too large");
		return {
			name,
			bytes: data.length,
			sha256: createHash("sha256").update(data).digest("hex"),
		};
	};
	return {
		pdf: record("report.pdf"),
		videos: [record("clip.webm"), record("clip.mp4")],
		duration: 6,
		dimensions: [320, 180],
	};
}
