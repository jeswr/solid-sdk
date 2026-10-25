#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

// Agent DESIGN §2.2. Fold this into check-sdk-layers.mjs when sdk-core T-003 lands.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".turbo",
  "__fixtures__",
]);
const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];
const modelSdks = ["openai", "@anthropic-ai/sdk"];
const agent = (name) => `@jeswr/agent-${name}`;
const allowed = {
  "agent-executor": new Set(["model", "mandate", "audit", "credentials", "channels"].map(agent)),
  "agent-model-gateway": new Set([agent("model"), agent("channels"), ...modelSdks]),
  "agent-channels": new Set([
    agent("model"),
    "@jeswr/guarded-fetch",
    "@jeswr/fetch-rdf",
    "@jeswr/rdf-serialize",
    "@solid/object",
    "@rdfjs/wrapper",
    "n3",
  ]),
};

function* walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
      yield* walk(join(directory, entry.name));
    else if (entry.isFile()) yield join(directory, entry.name);
  }
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function context(root, file) {
  const path = relative(root, file).replaceAll("\\", "/");
  const parts = path.split("/");
  return {
    path,
    project: parts[0] === "packages" ? parts[1] : undefined,
    ownTest:
      /^packages\/agent-channels\/(?:src|test)\//.test(path) &&
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path),
    test: /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)vitest\.config\.[cm]?[jt]s$/.test(
      path,
    ),
    ui: /^apps\/suite\/(?:src\/)?apps\/agent\//.test(path),
  };
}

// Normalize relative source paths too, so reaching into another package's src is no bypass.
function importTarget(root, file, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return specifier;
  const target = relative(root, resolve(dirname(file), specifier)).replaceAll("\\", "/");
  const match = /^packages\/([^/]+)\/(?:src|dist)\/(.*)$/.exec(target);
  if (!match) return specifier;
  const subpath = match[2].replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
  return `@jeswr/${match[1]}${subpath === "index" ? "" : `/${subpath}`}`;
}

function importFailures(ctx, target, typeOnly = false, manifest = false) {
  const failures = [];
  const name = packageName(target);
  const send = /^@jeswr\/agent-channels\/.+\/send(?:\/|$)/.test(target);
  if (send && ctx.project !== "agent-executor" && !ctx.ownTest)
    failures.push("send subpaths are executor-only (except agent-channels tests)");
  if (modelSdks.includes(name) && ctx.project !== "agent-model-gateway")
    failures.push("model SDKs are gateway-only");
  if (ctx.project === "agent-model-gateway" && name === agent("audit"))
    failures.push("gateway must not import agent-audit");
  // Package self-imports and Node builtins are not cross-layer dependencies.
  const external =
    !target.startsWith(".") && !target.startsWith("node:") && name !== `@jeswr/${ctx.project}`;
  if (external && !ctx.test) {
    const allowlist = allowed[ctx.project];
    if (allowlist && !allowlist.has(name) && !(ctx.project === "agent-executor" && send))
      failures.push(`${ctx.project} dependency is outside DESIGN §2.2`);
    if (ctx.project === "agent-executor" && name === agent("channels") && !send && !manifest)
      failures.push("executor may import channel send subpaths only");
    if (
      ctx.project === "agent-model-gateway" &&
      name === agent("channels") &&
      !typeOnly &&
      !manifest
    )
      failures.push("gateway may import channel ingest types only");
    if (ctx.ui) {
      const uiAllowed = new Set([agent("model"), agent("mandate"), agent("registry")]);
      if (
        (name.startsWith("@jeswr/") &&
          !uiAllowed.has(name) &&
          target !== "@jeswr/suite-sdk/react") ||
        send
      )
        failures.push("agent UI dependency is outside DESIGN §2.2");
      if (
        name === agent("mandate") &&
        !typeOnly &&
        !/^@jeswr\/agent-mandate\/(?:issue|verify)(?:\/|$)/.test(target)
      )
        failures.push("agent UI mandate values must use issue/verify subpaths");
    }
  }
  return failures;
}

function staticString(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return staticString(node.expression);
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "URL"
  )
    return staticString(node.arguments?.[0]);
  return undefined;
}

function declaredOrigins(source) {
  for (const statement of source.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "ORIGINS" ||
        !value ||
        !ts.isNewExpression(value) ||
        value.expression.getText(source) !== "Set"
      )
        continue;
      const values = value.arguments?.[0];
      if (values && ts.isArrayLiteralExpression(values))
        return new Set(values.elements.map((element) => staticString(element)));
    }
  }
  return undefined;
}

function bindingOrigins(root, file, source) {
  const local = declaredOrigins(source);
  if (local) return local;
  // Send halves can reuse the binding's exported allowlist without duplicating it.
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(".")
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (
      statement.importClause?.isTypeOnly ||
      !bindings ||
      !ts.isNamedImports(bindings) ||
      !bindings.elements.some(
        (element) =>
          !element.isTypeOnly &&
          element.name.text === "ORIGINS" &&
          (element.propertyName?.text ?? element.name.text) === "ORIGINS",
      )
    )
      continue;
    const target = resolve(dirname(file), statement.moduleSpecifier.text);
    const path = relative(join(root, "packages/agent-channels/src"), target);
    if (path.startsWith("..")) continue;
    const candidate = [target, target.replace(/\.[cm]?js$/, ".ts")].find((entry) =>
      existsSync(entry),
    );
    if (candidate)
      return declaredOrigins(
        ts.createSourceFile(
          candidate,
          readFileSync(candidate, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        ),
      );
  }
  return undefined;
}

function sourceFailures(root, file) {
  const ctx = context(root, file);
  const text = readFileSync(file, "utf8");
  const agentSource =
    ctx.project?.startsWith("agent-") || ctx.ui || ctx.path.startsWith("apps/agent-daemon/");
  // Existing apps include large generated modules. Preprocess their import tokens
  // before building an AST; only agent code needs the detailed direction/origin checks.
  // TypeScript's scanner also decodes escaped specifiers, unlike a text search.
  if (
    !agentSource &&
    !ts.preProcessFile(text, true, true).importedFiles.some(({ fileName }) => {
      const target = importTarget(root, file, fileName);
      return (
        modelSdks.includes(packageName(target)) ||
        /^@jeswr\/agent-channels\/.+\/send(?:\/|$)/.test(target)
      );
    })
  )
    return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const failures = [];
  const report = (node, message) =>
    failures.push(
      `${ctx.path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
    );
  const origins = ctx.project === "agent-channels" ? bindingOrigins(root, file, source) : undefined;
  const fetchNames = new Set(["fetch"]);
  const isFetch = (expression) =>
    (ts.isIdentifier(expression) && fetchNames.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) && expression.name.text === "fetch") ||
    (ts.isElementAccessExpression(expression) &&
      staticString(expression.argumentExpression) === "fetch");
  function declarations(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (
            (element.propertyName ?? element.name).getText(source) === "fetch" &&
            ts.isIdentifier(element.name)
          )
            fetchNames.add(element.name.text);
        }
      }
      if (
        ts.isIdentifier(node.name) &&
        (isFetch(node.initializer) ||
          (ts.isCallExpression(node.initializer) &&
            ts.isPropertyAccessExpression(node.initializer.expression) &&
            node.initializer.expression.name.text === "bind" &&
            isFetch(node.initializer.expression.expression)))
      )
        fetchNames.add(node.name.text);
    }
    ts.forEachChild(node, declarations);
  }
  declarations(source);
  function checkImport(node, specifier, typeOnly = false) {
    const value = staticString(specifier);
    if (value === undefined) {
      if (
        !ctx.test &&
        (ctx.project?.startsWith("agent-") || ctx.ui || ctx.path.startsWith("apps/agent-daemon/"))
      )
        report(node, "unverifiable dynamic import");
      return;
    }
    for (const failure of importFailures(ctx, importTarget(root, file, value), typeOnly))
      report(node, `${failure}: ${value}`);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly));
      checkImport(node, node.moduleSpecifier, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((element) => element.isTypeOnly));
      checkImport(node, node.moduleSpecifier, typeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      checkImport(node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      checkImport(node, node.argument.literal, true);
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
        checkImport(node, node.arguments[0]);
      if (ctx.project === "agent-channels" && !ctx.test && isFetch(node.expression)) {
        const url = staticString(node.arguments[0]);
        let origin;
        try {
          origin = new URL(url).origin;
        } catch {
          /* Unverifiable input fails closed below. */
        }
        if (!origin || !origins?.has(origin))
          report(
            node,
            "fetch target is not in this module's static ORIGINS; use the guarded transport seam for dynamic URLs",
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

/** Check a workspace (or isolated fixture workspace) without executing any source. */
export function checkAgentLayers(root = repoRoot) {
  const failures = [];
  for (const base of ["packages", "apps", "tools", "scripts", "test"]) {
    for (const file of walk(join(root, base))) {
      if (sourceExtensions.has(extname(file))) failures.push(...sourceFailures(root, file));
      if (file.endsWith("/package.json")) {
        const manifest = JSON.parse(readFileSync(file, "utf8"));
        const ctx = context(root, file);
        for (const field of [...dependencyFields, "devDependencies"]) {
          for (const [name, version] of Object.entries(manifest[field] ?? {})) {
            // Resolve npm aliases as well as direct dependency names.
            const target = version.startsWith("npm:")
              ? version.slice(4).replace(/@[^@/]*$/, "")
              : name;
            const dependencyContext = field === "devDependencies" ? { ...ctx, test: true } : ctx;
            for (const failure of importFailures(dependencyContext, target, false, true))
              failures.push(`${ctx.path}: ${failure}: ${target}`);
          }
        }
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = checkAgentLayers(process.argv[2] ? resolve(process.argv[2]) : repoRoot);
  if (failures.length) {
    console.error(
      `Agent layer guard failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else console.log("Agent layer guard passed.");
}
