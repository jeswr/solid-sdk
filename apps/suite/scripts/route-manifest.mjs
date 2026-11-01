// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { compareRank, matchRoute, reservedSuffix } from "./route-resolver.mjs";

export async function filesUnder(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported bundle entry: ${path}`);
  }
  return files.sort();
}

/** Use the TS parser so comments cannot conceal a feature or trigger a false positive. */
export async function checkServerFeatures(
  sourceRoot,
  config = {},
  projectRoot = dirname(sourceRoot),
) {
  for (const name of ["middleware.ts", "middleware.js", "proxy.ts", "proxy.js"]) {
    const path = join(projectRoot, name);
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`Native export forbids middleware: ${path}`);
  }
  if (config.rewrites) throw new Error("Native export forbids rewrites");
  for (const path of await filesUnder(sourceRoot)) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    if (/^(middleware|proxy)\.[jt]s$/.test(basename(path)))
      throw new Error(`Native export forbids middleware: ${path}`);
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const forceStatic = source.statements.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
        statement.declarationList.declarations.some(
          (node) =>
            node.name.getText(source) === "dynamic" &&
            node.initializer &&
            ts.isStringLiteral(node.initializer) &&
            node.initializer.text === "force-static",
        ),
    );
    const visit = (node) => {
      // Biome's importNames restriction does not cover dynamic module namespaces.
      // Require static named imports so useParams cannot bypass the routing hook.
      const loader =
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require") &&
        node.arguments[0];
      if (loader && ts.isStringLiteralLike(loader) && nextModule(loader.text, "navigation"))
        throw new Error(
          `Native routing forbids dynamic next/navigation imports; use useRouteParams: ${path}`,
        );
      // A computed specifier that starts inside next/ cannot be checked, so refuse it.
      if (loader && !ts.isStringLiteralLike(loader) && /^next\//.test(leadingText(loader)))
        throw new Error(`Native export forbids computed next/ module specifiers: ${path}`);
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        node.moduleSpecifier.text !== "next/navigation" &&
        nextModule(node.moduleSpecifier.text, "navigation")
      )
        throw new Error(`Native routing forbids aliased next/navigation imports: ${path}`);
      if (
        (ts.isStringLiteral(node) && node.text === "use server") ||
        (ts.isStringLiteralLike(node) && nextModule(node.text, "headers")) ||
        (ts.isCallExpression(node) && /^(headers|cookies)$/.test(node.expression.getText(source)))
      )
        throw new Error(`Native export forbids server-only features: ${path}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (/^route\.[jt]s$/.test(basename(path)) && !forceStatic)
      throw new Error(`Native route handler must be force-static: ${path}`);
  }
}

/** next/<name>, its .js spelling, or Next's internal dist path for the same module. */
function nextModule(specifier, name) {
  const bare = specifier.replace(/\.js$/, "");
  return bare === `next/${name}` || new RegExp(`^next/dist/.*/${name}$`).test(bare);
}

/** The literal text a computed module specifier starts with (template head or leftmost string). */
function leadingText(node) {
  if (ts.isTemplateExpression(node)) return node.head.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return leadingText(node.left);
  if (ts.isParenthesizedExpression(node)) return leadingText(node.expression);
  return ts.isStringLiteralLike(node) ? node.text : "";
}

export function routeSegments(path) {
  const parts = path.split("/").filter(Boolean);
  const segments = [];
  for (const part of parts) {
    if (reservedSuffix(part)) throw new Error(`Reserved transport suffix in static route: ${path}`);
    if (part.startsWith("@") || part.startsWith("_")) return;
    if (part.startsWith("(") && !part.endsWith(")"))
      throw new Error(`Intercepting route must be dropped in native staging: ${path}`);
    if (part.startsWith("(")) continue;
    const catchAll = /^\[\[?\.\.\.(.+?)\]\]?$/.exec(part);
    if (catchAll)
      segments.push({ type: "catch-all", name: catchAll[1], optional: part.startsWith("[[") });
    else if (/^\[.+\]$/.test(part)) segments.push({ type: "param", name: part.slice(1, -1) });
    else segments.push({ type: "static", value: part });
  }
  if (segments.slice(0, -1).some((segment) => segment.type === "catch-all"))
    throw new Error(`Catch-all must be the last segment: ${path}`);
  return segments;
}

/** A tie requires equal precedence at each consumed segment. Check symbolic intersections. */
export function assertUnambiguous(routes) {
  for (let i = 0; i < routes.length; i++) {
    for (const right of routes.slice(i + 1)) {
      const left = routes[i];
      const length = Math.max(left.segments.length, right.segments.length);
      // With terminal catch-alls, max length + one is sufficient to witness every overlap.
      for (const count of [Math.max(0, length - 1), length, length + 1]) {
        const values = Array.from({ length: count }, (_, n) => {
          const a = left.segments[n];
          const b = right.segments[n];
          return a?.type === "static" ? a.value : b?.type === "static" ? b.value : "value";
        });
        const a = matchRoute(left.segments, values);
        const b = matchRoute(right.segments, values);
        if (a && b && compareRank(a, b) === 0)
          throw new Error(`Ambiguous native routes: ${left.pattern} and ${right.pattern}`);
      }
    }
  }
}

export async function createManifest({
  appDir,
  exportDir,
  sourceRoot = dirname(appDir),
  config = {},
  projectRoot = dirname(sourceRoot),
  adaptations = [],
}) {
  await checkServerFeatures(sourceRoot, config, projectRoot);
  const exported = (await filesUnder(exportDir)).map((path) =>
    relative(exportDir, path).split("\\").join("/"),
  );
  const routes = [];
  const owned = new Set();
  for (const path of await filesUnder(appDir)) {
    if (!/^page\.[jt]sx?$/.test(basename(path))) continue;
    const pattern = `/${relative(appDir, dirname(path)).split("\\").join("/")}`;
    const segments = routeSegments(pattern);
    if (!segments) continue;
    const directory = segments
      .map((segment) => (segment.type === "static" ? segment.value : "__"))
      .join("/");
    const prefix = directory ? `${directory}/` : "";
    const files = exported
      .filter((file) => file.startsWith(prefix) && reservedSuffix(file.slice(prefix.length)))
      .map((file) => file.slice(prefix.length));
    if (!files.includes("index.html"))
      throw new Error(`Missing native placeholder export: ${pattern} (${prefix}index.html)`);
    for (const file of files) owned.add(`${prefix}${file}`);
    routes.push({ pattern, segments, directory, files });
  }
  assertUnambiguous(routes);
  // Exact assets include public files, framework assets and the explicit 404, never route transports.
  const assets = exported.filter((file) => !owned.has(file));
  return { version: 1, routes, assets, adaptations };
}

export async function writeManifest(options) {
  const manifest = await createManifest(options);
  await writeFile(
    join(options.exportDir, "route-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const adaptation of manifest.adaptations) console.log(`Native adaptation: ${adaptation}`);
  console.log(
    `Native manifest: ${manifest.routes.length} routes, ${manifest.assets.length} exact assets`,
  );
  return manifest;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [appDir, exportDir] = process.argv.slice(2);
  process.env.NEXT_PUBLIC_SUITE_TARGET = "native";
  const configPath = join(dirname(dirname(appDir)), "next.config.ts");
  const config = await access(configPath).then(
    async () => (await import(pathToFileURL(configPath).href)).default,
    () => ({}),
  );
  await writeManifest({ appDir, exportDir, config });
}
