#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

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

function allowedModuleSpecifier(specifier) {
  // Check the decoded literal before path normalization can hide a URL/query/fragment.
  // Schemes (including node:) and absolute paths are outside the agent allowlist.
  return (
    !/[:?#\\]/.test(specifier) &&
    (/^\.{1,2}\//.test(specifier) ||
      /^(?:@[a-z0-9_~-][a-z0-9._~-]*\/)?[a-z0-9_~-][a-z0-9._~-]*(?:\/[^/]+)*$/i.test(specifier))
  );
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

const forbiddenGlobals = new Set(["fetch", "globalThis", "global", "window", "self"]);
const commonJsLoaders = new Set(["require", "createRequire"]);

function isPropertyName(node) {
  const parent = node.parent;
  // Computed keys and shorthand properties read an identifier; ordinary keys do not.
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
      parent.name === node)
  );
}

function sourceFailures(root, file) {
  const ctx = context(root, file);
  const text = readFileSync(file, "utf8");
  const agentSource =
    ctx.project?.startsWith("agent-") || ctx.ui || ctx.path.startsWith("apps/agent-daemon/");
  // Existing apps include large generated modules. Preprocess their import tokens
  // before building an AST; only agent code needs the detailed capability checks.
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
  function checkImport(node, specifier, typeOnly = false) {
    const value = specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
    if (value === undefined) {
      if (agentSource) report(node, "unverifiable dynamic import; use a string literal");
      return;
    }
    if (agentSource && !allowedModuleSpecifier(value))
      report(node, `agent module specifier must be a bare package name or relative path: ${value}`);
    for (const failure of importFailures(ctx, importTarget(root, file, value), typeOnly))
      report(node, `${failure}: ${value}`);
  }
  function visit(node) {
    // Reject capabilities at their reference, so wrappers and aliases cannot hide them.
    if (agentSource) {
      if (ts.isIdentifier(node)) {
        if (commonJsLoaders.has(node.text))
          report(node, "CommonJS loaders are forbidden; use literal ESM imports");
        if (forbiddenGlobals.has(node.text) && !isPropertyName(node))
          report(node, `forbidden agent identifier: ${node.text}; use the guarded-fetch adapter`);
      } else if (ts.isStringLiteralLike(node) && commonJsLoaders.has(node.text)) {
        let reference = node;
        while (reference.parent && ts.isOuterExpression(reference.parent))
          reference = reference.parent;
        const parent = reference.parent;
        if (
          (ts.isElementAccessExpression(parent) && parent.argumentExpression === reference) ||
          ts.isComputedPropertyName(parent) ||
          (ts.isBindingElement(parent) && parent.propertyName === reference) ||
          ts.isImportSpecifier(parent) ||
          ts.isExportSpecifier(parent)
        )
          report(node, "CommonJS loaders are forbidden; use literal ESM imports");
      }
    }
    if (ts.isImportDeclaration(node)) {
      // Inline type specifiers still emit a module load under verbatimModuleSyntax.
      checkImport(node, node.moduleSpecifier, node.importClause?.isTypeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      checkImport(node, node.moduleSpecifier, node.isTypeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      if (agentSource) report(node, "CommonJS import-equals is forbidden; use literal ESM imports");
      checkImport(node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      checkImport(node, node.argument.literal, true);
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
        checkImport(node, node.arguments[0]);
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
