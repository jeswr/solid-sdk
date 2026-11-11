// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Build self-contained runtime, renderer, and declarations for mirror installs
 * under ignore-scripts=true. Workspace dependencies (including the private
 * agent-model) are bundled; only the npm dependencies below stay external.
 *
 * TypeScript expands ChannelCapability from the model's inferred schema when
 * emitting declarations, preserving its exact shape without shipping a model
 * or Zod type import. dist/ is built here and committed only in the mirrors.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

/** Keep source paths stable across checkouts and symlinked node_modules. */
function toPkgRelativeSource(source) {
  const nm = source.indexOf("node_modules/");
  if (nm !== -1) return source.slice(nm);
  const src = source.indexOf("src/");
  if (src !== -1) return source.slice(src);
  return source;
}

/** Npm dependencies declared by this package; all other runtime code is bundled. */
const EXTERNAL = [
  "n3",
  "@rdfjs/wrapper",
  "@rdfjs/types",
  "jsonld-streaming-parser",
  "content-type",
  "undici",
];

function emitDeclarations(buildDir) {
  const configPath = join(root, "tsconfig.build.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {
    outDir: buildDir,
  });
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (file) => file,
        getNewLine: () => "\n",
      }),
    );
  }
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(join(root, "src/types.ts"));
  const modelImport = source.statements.find(
    (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === "@jeswr/agent-model",
  );
  const imported = modelImport.importClause.namedBindings.elements.find(
    (node) => node.name.text === "ChannelCapability",
  );
  const capability = checker.typeToTypeNode(
    checker.getTypeAtLocation(imported),
    undefined,
    ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias,
  );
  if (!capability || !ts.isTypeLiteralNode(capability)) {
    throw new Error("build-dist: expected a self-contained ChannelCapability object type.");
  }
  const result = program.emit(undefined, undefined, undefined, true, {
    afterDeclarations: [
      (context) => (file) => {
        const visit = (node) => {
          if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "@jeswr/agent-model") {
            const names = node.importClause?.namedBindings;
            if (
              !names ||
              !ts.isNamedImports(names) ||
              names.elements.some((name) => name.name.text !== "ChannelCapability")
            )
              throw new Error("build-dist: unexpected private model type import.");
            return undefined;
          }
          if (
            ts.isTypeReferenceNode(node) &&
            ts.isIdentifier(node.typeName) &&
            node.typeName.text === "ChannelCapability"
          )
            return capability;
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(file, visit);
      },
    ],
  });
  if (result.emitSkipped || result.diagnostics.length)
    throw new Error("build-dist: declaration emission failed.");
}

async function main(buildDir = outdir) {
  execFileSync("node", [join(root, "scripts/build-deps.mjs")], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });

  rmSync(buildDir, { recursive: true, force: true });
  await build({
    entryPoints: {
      index: join(root, "src/index.ts"),
      "render-card": join(root, "scripts/render-card-entry.mjs"),
    },
    outdir: buildDir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: EXTERNAL,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });

  for (const entry of ["index", "render-card"]) {
    const indexFile = join(buildDir, `${entry}.js`);
    const mapFile = join(buildDir, `${entry}.js.map`);
    // Normalize esbuild's module comments and sourcemap sources before shipping.
    const normalisedJs = readFileSync(indexFile, "utf8").replace(
      /^\/\/ \S*\/(node_modules\/\S*)$/gm,
      "// $1",
    );
    writeFileSync(indexFile, normalisedJs, "utf8");
    const map = JSON.parse(readFileSync(mapFile, "utf8"));
    if (Array.isArray(map.sources)) map.sources = map.sources.map(toPkgRelativeSource);
    writeFileSync(mapFile, JSON.stringify(map), "utf8");

    for (const file of [indexFile, mapFile]) {
      const leak = readFileSync(file, "utf8").match(/\/(?:Users|home)\/[^\s"']+/);
      if (leak)
        throw new Error(`build-dist: artifact ${file} leaks an absolute local path: ${leak[0]}`);
    }
  }

  emitDeclarations(buildDir);
}

const argDir = process.argv[2];
await main(argDir ? (isAbsolute(argDir) ? argDir : resolve(process.cwd(), argDir)) : outdir);
