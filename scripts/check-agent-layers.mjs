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
  ".next",
  "out",
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

function unwrapExpression(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node))
  )
    node = node.expression;
  return node;
}

function staticString(node) {
  node = unwrapExpression(node);
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "URL"
  )
    return staticString(node.arguments?.[0]);
  return undefined;
}

function isGlobalObject(node) {
  node = unwrapExpression(node);
  return ts.isIdentifier(node) && ["globalThis", "window", "self"].includes(node.text);
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isComputedPropertyName(node)) return staticString(node.expression);
  return ts.isIdentifier(node) ? node.text : staticString(node);
}

function isFetch(node) {
  node = unwrapExpression(node);
  return (
    (ts.isIdentifier(node) && node.text === "fetch") ||
    (ts.isPropertyAccessExpression(node) && node.name.text === "fetch") ||
    (ts.isElementAccessExpression(node) && staticString(node.argumentExpression) === "fetch")
  );
}

function isRawFetchReference(node) {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return isGlobalObject(node.expression) && isFetch(node);
  if (!ts.isIdentifier(node) || node.text !== "fetch") return false;
  const parent = node.parent;
  // Property names, binding declarations and type queries do not read the global value.
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isTypeQueryNode(parent)) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isExportAssignment(parent)) return parent.expression === node;
  if (ts.isExportSpecifier(parent))
    return (
      !parent.isTypeOnly &&
      !parent.parent.parent.isTypeOnly &&
      !parent.parent.parent.moduleSpecifier &&
      (parent.propertyName ?? parent.name) === node
    );
  return ts.isExpressionNode(node);
}

function directCall(reference) {
  // Walk out through wrappers so `(fetch as typeof fetch)(url)` is still a direct call.
  while (
    reference.parent.expression === reference &&
    unwrapExpression(reference.parent) !== reference.parent
  )
    reference = reference.parent;
  return ts.isCallExpression(reference.parent) && reference.parent.expression === reference
    ? reference.parent
    : undefined;
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
  const origins =
    ctx.project === "agent-channels" ? bindingOrigins(root, file, source) : declaredOrigins(source);
  const checkFetch = agentSource && !ctx.test;
  function checkOrigin(call) {
    const url = staticString(call.arguments[0]);
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      /* Unverifiable input fails closed below. */
    }
    if (!origin || !origins?.has(origin))
      report(
        call,
        "fetch target is not in this module's static ORIGINS; use the guarded transport seam for dynamic URLs",
      );
  }
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
  function visit(node, inType = false) {
    // TypeScript also labels runtime class bases and generic instantiations as type nodes.
    inType ||= ts.isExpressionWithTypeArguments(node)
      ? ts.isHeritageClause(node.parent) &&
        (ts.isInterfaceDeclaration(node.parent.parent) ||
          node.parent.token === ts.SyntaxKind.ImplementsKeyword)
      : ts.isTypeNode(node);
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
      // Retain the existing binding checks for injected transports such as io.fetch.
      if (ctx.project === "agent-channels" && checkFetch && isFetch(node.expression))
        checkOrigin(node);
    }
    if (checkFetch && !inType) {
      if (isRawFetchReference(node)) {
        const call = directCall(node);
        if (!call) report(node, "raw fetch reference must be a direct call with static ORIGINS");
        else if (ctx.project !== "agent-channels") checkOrigin(call);
      }
      // Destructuring reads a property without a fetch member expression in the AST.
      const bindings =
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        isGlobalObject(node.initializer)
          ? node.name.elements
          : ts.isBinaryExpression(node) &&
              node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isObjectLiteralExpression(unwrapExpression(node.left)) &&
              isGlobalObject(node.right)
            ? unwrapExpression(node.left).properties
            : [];
      for (const binding of bindings) {
        if (propertyName(binding.propertyName ?? binding.name) === "fetch")
          report(binding, "raw fetch destructuring cannot be validated with static ORIGINS");
      }
    }
    ts.forEachChild(node, (child) => visit(child, inType));
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
