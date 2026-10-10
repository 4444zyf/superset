import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "@typescript/typescript6";

test("default main, preload and renderer cannot import the legacy cloud bootstrap", () => {
	const src = resolve(import.meta.dir, "../../..");
	const visited = new Set<string>();
	const forbidden =
		/legacy-cloud|cloud-router|routeTree\.gen|auth-client|\/posthog|\/sentry|host-service-coordinator|@superset\/(auth|cloud-client)/;
	function visit(file: string) {
		if (visited.has(file)) return;
		visited.add(file);
		const ast = ts.createSourceFile(
			file,
			readFileSync(file, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		for (const statement of ast.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				!ts.isStringLiteral(statement.moduleSpecifier) ||
				statement.importClause?.isTypeOnly
			)
				continue;
			const bindings = statement.importClause?.namedBindings;
			if (
				bindings &&
				ts.isNamedImports(bindings) &&
				bindings.elements.every((binding) => binding.isTypeOnly)
			)
				continue;
			const specifier = statement.moduleSpecifier.text;
			expect(forbidden.test(specifier), `${file} imports ${specifier}`).toBe(
				false,
			);
			if (!specifier.startsWith(".")) continue;
			const target = resolve(dirname(file), specifier);
			const resolved = [
				target,
				`${target}.ts`,
				`${target}.tsx`,
				`${target}/index.ts`,
				`${target}/index.tsx`,
			].find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
			if (resolved) visit(resolved);
		}
	}
	for (const file of [
		"main/index.ts",
		"preload/index.ts",
		"renderer/index.tsx",
	])
		visit(resolve(src, file));
});
