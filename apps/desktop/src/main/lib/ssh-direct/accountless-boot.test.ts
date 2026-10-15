import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "@typescript/typescript6";

test("default main, preload and renderer cannot import the legacy cloud bootstrap", () => {
	const src = resolve(import.meta.dir, "../../..");
	const visited = new Set<string>();
	const forbidden =
		/legacy-cloud|cloud-router|cloud-trpc|routeTree\.gen|auth-client|\/posthog|\/sentry|host-service-coordinator|@superset\/(auth|cloud-client)/;
	function visit(file: string) {
		if (visited.has(file)) return;
		visited.add(file);
		const ast = ts.createSourceFile(
			file,
			readFileSync(file, "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		const references: string[] = [];
		function collect(node: ts.Node) {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				if (ts.isImportDeclaration(node)) {
					if (node.importClause?.isTypeOnly) return;
					const bindings = node.importClause?.namedBindings;
					if (
						!node.importClause?.name &&
						bindings &&
						ts.isNamedImports(bindings) &&
						bindings.elements.every((binding) => binding.isTypeOnly)
					)
						return;
				} else if (node.isTypeOnly) return;
				references.push(node.moduleSpecifier.text);
			}
			if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword
			) {
				const argument = node.arguments[0];
				if (argument && ts.isStringLiteral(argument))
					references.push(argument.text);
			}
			ts.forEachChild(node, collect);
		}
		collect(ast);
		for (const specifier of references) {
			expect(forbidden.test(specifier), `${file} imports ${specifier}`).toBe(
				false,
			);
			const target = specifier.startsWith(".")
				? resolve(dirname(file), specifier)
				: /^(main|renderer|shared|lib)\//.test(specifier)
					? resolve(src, specifier)
					: null;
			if (!target) continue;
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
