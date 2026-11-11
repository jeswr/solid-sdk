// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : /\.[jt]sx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
it("keeps RDF and model runtime imports out of agent components and routes", () => {
  const banned =
    /^(?:n3|@rdfjs\/|@jeswr\/(?:fetch-rdf|rdf-serialize|agent-model|agent-mandate)(?:$|\/))/;
  for (const file of [
    ...sources("src/apps/agent/components"),
    ...sources("src/app/(suite)/agent"),
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const typesOnly =
          clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((element) => element.isTypeOnly));
        if (!typesOnly) expect(node.moduleSpecifier.text, file).not.toMatch(banned);
      }
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        expect(node.moduleSpecifier.text, file).not.toMatch(banned);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument))
          expect(argument.text, file).not.toMatch(banned);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});
