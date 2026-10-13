import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brand = JSON.parse(
	readFileSync(resolve(root, "packages/shared/src/product-brand.json"), "utf8"),
);
const mark = readFileSync(resolve(root, "assets/branding/mark.svg"), "utf8");
const paths = [...mark.matchAll(/<path d="([^"]+)"\/>/g)].map(
	(match) => match[1],
);
assert.equal(paths.length, 3);
const geometry = paths.map((d) => `<path d="${d}"/>`).join("");
const escapedName = brand.displayName
	.replaceAll("&", "&amp;")
	.replaceAll("<", "&lt;")
	.replaceAll('"', "&quot;");
const outputs = new Map();
const svg = (body, width = 1024, height = width) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
const wordmark = svg(
	`<g transform="translate(0 8) scale(2.5)" fill="#ededef">${geometry}</g><text x="100" y="65" fill="#ededef" font-family="Inter,Arial,sans-serif" font-size="44" font-weight="600">${escapedName}</text>`,
	600,
	96,
);
outputs.set("assets/branding/wordmark.svg", wordmark);
outputs.set(
	"apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/assets/superset-empty-state-wordmark.svg",
	wordmark,
);
outputs.set(
	"packages/shared/src/product-brand-mark.json",
	`${JSON.stringify({ viewBox: "0 0 32 32", paths }, null, "\t")}\n`,
);
for (const [theme, color] of [
	["light", "#ededef"],
	["dark", "#17181b"],
])
	outputs.set(
		`assets/branding/mark-${theme}.svg`,
		mark.replace('fill="currentColor"', `fill="${color}"`),
	);
function icns(images) {
	const chunks = images.map(([type, bytes]) => {
		const header = Buffer.alloc(8);
		header.write(type);
		header.writeUInt32BE(bytes.length + 8, 4);
		return Buffer.concat([header, bytes]);
	});
	const header = Buffer.alloc(8);
	header.write("icns");
	header.writeUInt32BE(
		8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
		4,
	);
	return Buffer.concat([header, ...chunks]);
}
function ico(images) {
	const header = Buffer.alloc(6 + images.length * 16);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach(([size, bytes], index) => {
		const base = 6 + index * 16;
		header[base] = size === 256 ? 0 : size;
		header[base + 1] = header[base];
		header.writeUInt16LE(1, base + 4);
		header.writeUInt16LE(32, base + 6);
		header.writeUInt32LE(bytes.length, base + 8);
		header.writeUInt32LE(offset, base + 12);
		offset += bytes.length;
	});
	return Buffer.concat([header, ...images.map(([, bytes]) => bytes)]);
}
for (const channel of ["", "-dev", "-canary"]) {
	const badge = channel
		? `<circle cx="805" cy="215" r="76" fill="#b9adff"/><text x="805" y="240" fill="#17181b" font-family="Arial,sans-serif" text-anchor="middle" font-size="72" font-weight="700">${channel === "-dev" ? "D" : "C"}</text>`
		: "";
	const master = svg(
		`<defs><linearGradient id="tile" x2="0" y2="1"><stop stop-color="#24252b"/><stop offset="1" stop-color="#121316"/></linearGradient></defs><rect x="100" y="100" width="824" height="824" rx="184" fill="url(#tile)"/><g transform="translate(128 128) scale(24)" fill="#ededef">${geometry}</g>${badge}`,
	);
	outputs.set(`assets/branding/app-icon${channel}.svg`, master);
	const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
	const pngs = new Map(
		await Promise.all(
			sizes.map(async (size) => [
				size,
				await sharp(Buffer.from(master)).resize(size, size).png().toBuffer(),
			]),
		),
	);
	outputs.set(
		`apps/desktop/src/resources/build/icons/icon${channel}.png`,
		pngs.get(1024),
	);
	outputs.set(
		`apps/desktop/src/resources/build/icons/icon${channel}.icns`,
		icns([
			["icp4", pngs.get(16)],
			["icp5", pngs.get(32)],
			["icp6", pngs.get(64)],
			["ic07", pngs.get(128)],
			["ic08", pngs.get(256)],
			["ic09", pngs.get(512)],
			["ic10", pngs.get(1024)],
		]),
	);
	outputs.set(
		`apps/desktop/src/resources/build/icons/icon${channel}.ico`,
		ico(
			sizes.filter((size) => size <= 256).map((size) => [size, pngs.get(size)]),
		),
	);
	if (!channel)
		for (const size of [16, 24, 32, 128, 1024])
			outputs.set(`assets/branding/icon-${size}.png`, pngs.get(size));
}
const tray = svg(`<g fill="#000">${geometry}</g>`, 32);
outputs.set(
	"apps/desktop/src/resources/tray/iconTemplate.png",
	await sharp(Buffer.from(tray)).resize(32, 32).png().toBuffer(),
);
const installer = svg(
	`<rect width="540" height="380" fill="#17181b"/><path d="M225 170h90m-16-14 16 14-16 14" fill="none" stroke="#b9adff" stroke-width="4"/><text x="270" y="310" text-anchor="middle" fill="#ededef" font-family="Inter,Arial,sans-serif" font-size="23">${escapedName}</text>`,
	540,
	380,
);
outputs.set(
	"apps/desktop/src/resources/build/installer/background.tiff",
	await sharp(Buffer.from(installer)).tiff({ compression: "lzw" }).toBuffer(),
);
for (const notice of ["LICENSE.md", "FORK_NOTICE.md"])
	outputs.set(
		`apps/desktop/src/resources/legal/${notice}`,
		readFileSync(resolve(root, notice)),
	);
const metadata = JSON.parse(
	readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"),
);
metadata.productName = brand.displayName;
metadata.description =
	"An unofficial modified version of Superset with local and SSH workstations";
metadata.repository = {
	type: "git",
	url: `${brand.forkRepository}.git`,
	directory: "apps/desktop",
};
metadata.homepage = brand.forkRepository;
outputs.set(
	"apps/desktop/package.json",
	`${JSON.stringify(metadata, null, "\t")}\n`,
);
const extension = JSON.parse(
	readFileSync(
		resolve(root, "apps/desktop/src/resources/browser-extension/manifest.json"),
		"utf8",
	),
);
extension.name = `${brand.displayName} Browser Tools`;
extension.description = `Browser tools for ${brand.displayName}, an unofficial modified version of Superset`;
outputs.set(
	"apps/desktop/src/resources/browser-extension/manifest.json",
	`${JSON.stringify(extension, null, "\t")}\n`,
);
for (const [file, value] of outputs) {
	const target = resolve(root, file);
	const bytes = file.endsWith(".json")
		? execFileSync(
				process.execPath,
				[
					resolve(root, "node_modules/@biomejs/biome/bin/biome"),
					"format",
					"--stdin-file-path",
					file,
				],
				{ input: value },
			)
		: Buffer.isBuffer(value)
			? value
			: Buffer.from(value);
	if (process.argv.includes("--check"))
		assert.deepEqual(
			readFileSync(target),
			bytes,
			`Stale brand output: ${file}`,
		);
	else {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, bytes);
	}
}
console.log(
	`${process.argv.includes("--check") ? "Verified" : "Generated"} ${outputs.size} brand resources with sharp ${sharp.versions.sharp}`,
);
