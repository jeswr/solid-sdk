// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * dist-imports — print, as JSON, the set of BARE (external) module specifiers the
 * committed `dist/index.js` + `dist/react/index.js` actually import, computed from
 * esbuild's accurate import graph (NOT a regex over minified text — that would be
 * fooled by a string literal in the bundle that looks like `import(...)`).
 *
 * Used by the §8 packaged-dist smoke test, which cannot run esbuild itself
 * (esbuild refuses to run inside vitest's jsdom environment — jsdom's TextEncoder
 * trips esbuild's TextEncoder invariant). So the test shells out to this script in
 * a clean Node process and asserts on the JSON it prints.
 *
 * Mechanism: re-bundle the committed dist entries with EVERYTHING external (an
 * onResolve plugin that externalises every bare specifier, while letting esbuild
 * walk the dist's OWN relative/absolute files into the shared chunk), and collect
 * every `import.external` edge from the metafile.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const distIndex = join(root, "dist", "index.js");
const distReact = join(root, "dist", "react", "index.js");

const result = await build({
  entryPoints: [distIndex, distReact],
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "node",
  // Required by esbuild when there are multiple entry points (we never write —
  // `write:false` keeps it in memory; this is only to satisfy the API).
  outdir: join(root, ".smoke-analysis-out"),
  logLevel: "silent",
  plugins: [
    {
      name: "externalize-all",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          // Keep the dist's own relative/absolute files resolvable (walk into the
          // shared chunk); externalise every bare specifier so we record its edge.
          if (args.path.startsWith(".") || args.path.startsWith("/")) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

const specs = new Set();
for (const input of Object.values(result.metafile.inputs)) {
  for (const imp of input.imports) {
    if (imp.external && !imp.path.startsWith(".") && !imp.path.startsWith("/")) {
      specs.add(imp.path);
    }
  }
}

process.stdout.write(JSON.stringify([...specs].sort()));
