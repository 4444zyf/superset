import { readFileSync } from "node:fs";

const brand = JSON.parse(
	readFileSync(
		new URL("../packages/shared/src/product-brand.json", import.meta.url),
		"utf8",
	),
);
const field = process.argv[2];
if (!Object.hasOwn(brand, field) || typeof brand[field] !== "string")
	throw new Error("Unknown brand field");
process.stdout.write(`${brand[field]}\n`);
